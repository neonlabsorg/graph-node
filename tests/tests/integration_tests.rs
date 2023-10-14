//! Containeraized integration tests.
//!
//! # On the use of [`tokio::join!`]
//!
//! While linear `.await`s look best, sometimes we don't particularly care
//! about the order of execution and we can thus reduce test execution times by
//! `.await`ing in parallel. [`tokio::join!`] and similar macros can help us
//! with that, at the cost of some readability. As a general rule only a few
//! tasks are really worth parallelizing, and applying this trick
//! indiscriminately will only result in messy code and diminishing returns.

use anyhow::Context;
use futures::{StreamExt, TryStreamExt};
use graph_tests::helpers::{
    basename, pretty_output
};
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use tokio::process::{Command};

/// All directories containing integration tests to run.
///
/// Hardcoding these paths seems "wrong", and we very well could obtain this
/// list with some directory listing magic. That would, however, also
/// require us to filter out `node_modules`, support files, etc.. Hardly worth
/// it.
pub const INTEGRATION_TEST_DIRS: &[&str] = &[
    "api-version-v0-0-4",
    "chain-reverts",
    "host-exports",
    "non-fatal-errors",
    "overloaded-contract-functions",
    "poi-for-failed-subgraph",
    "remove-then-update",
    "value-roundtrip",
    "int8",
    "block-handlers",
];

const IPFS_URI: String = "https://ch-ipfs.neontest.xyz";
const GRAPH_NODE_ADMIN_URI: String = "https://ch2-graph.neontest.xyz/deploy/";
const SUBGRAPH_NAME: String = "test-subgraph";

#[derive(Debug, Clone)]
struct IntegrationTestSettings {
    n_parallel_tests: u64,
}

impl IntegrationTestSettings {
    /// Automatically fills in missing env. vars. with defaults.
    ///
    /// # Panics
    ///
    /// Panics if any of the env. vars. is set incorrectly.
    pub fn from_env() -> Self {
        Self {
            n_parallel_tests: parse_numeric_environment_variable("N_CONCURRENT_TESTS").unwrap_or(
                // Lots of I/O going on in these tests, so we spawn twice as
                // many jobs as suggested.
                2 * std::thread::available_parallelism()
                    .map(NonZeroUsize::get)
                    .unwrap_or(2) as u64,
            )
        }
    }
}

/// An aggregator of all configuration and settings required to run a single
/// integration test.
#[derive(Debug)]
struct IntegrationTestRecipe {
    ipfs_uri: String,
    graph_node_uri: String,
    subgraph_name: String,
    test_directory: PathBuf,
}

impl IntegrationTestRecipe {
    fn test_name(&self) -> String {
        basename(&self.test_directory)
    }
}

/// Info about a finished test command
#[derive(Debug)]
struct IntegrationTestResult {
    success: bool,
    _exit_status_code: Option<i32>,
    output: Output,
}

#[derive(Debug)]
struct Output {
    stdout: Option<String>,
    stderr: Option<String>,
}

impl std::fmt::Display for Output {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(ref stdout) = self.stdout {
            write!(f, "{}", stdout)?;
        }
        if let Some(ref stderr) = self.stderr {
            write!(f, "{}", stderr)?
        }
        Ok(())
    }
}

// The results of a finished integration test
#[derive(Debug)]
struct IntegrationTestSummary {
    test_recipe: IntegrationTestRecipe,
    test_command_result: IntegrationTestResult,
}

impl IntegrationTestSummary {
    fn print_outcome(&self) {
        let status = match self.test_command_result.success {
            true => "SUCCESS",
            false => "FAILURE",
        };
        println!("- Test: {}: {}", status, self.test_recipe.test_name())
    }

    fn print_failure(&self) {
        if self.test_command_result.success {
            return;
        }
        let test_name = self.test_recipe.test_name();
        println!("=============");
        println!("\nFailed test: {}", test_name);
        println!("-------------");
        println!("{:#?}", self.test_recipe);
        println!("-------------");
        println!("\nFailed test command output:");
        println!("---------------------------");
        println!("{}", self.test_command_result.output);
        println!("--------------------------");
    }
}

/// The main test entrypoint.
#[tokio::test]
async fn parallel_integration_tests() -> anyhow::Result<()> {
    let test_settings = IntegrationTestSettings::from_env();

    let current_working_dir =
        std::env::current_dir().context("failed to identify working directory")?;
    let yarn_workspace_dir = current_working_dir.join("integration-tests");
    let test_dirs = INTEGRATION_TEST_DIRS
        .iter()
        .map(|p| yarn_workspace_dir.join(PathBuf::from(p)))
        .collect::<Vec<PathBuf>>();

    // Show discovered tests.
    println!("Found {} integration test(s):", test_dirs.len());
    for dir in &test_dirs {
        println!("  - {}", basename(dir));
    }

    tokio::join!(
        // Run `yarn` command to build workspace.
        run_yarn_command(&yarn_workspace_dir),
    );

    println!(
        "Running tests with N_CONCURRENT_TESTS={} ...",
        test_settings.n_parallel_tests
    );

    let stream = tokio_stream::iter(test_dirs)
        .map(|dir| {
            let name = [basename(dir), SUBGRAPH_NAME.to_string()].join("-");
            run_integration_test(
                dir,
                IPFS_URI.to_string(),
                GRAPH_NODE_ADMIN_URI.to_string(),
                name,
            )
        })
        .buffered(test_settings.n_parallel_tests as usize);

    let test_results: Vec<IntegrationTestSummary> = stream.try_collect().await?;
    let failed = test_results.iter().any(|r| !r.test_command_result.success);

    // All tests have finished; we don't need the containers anymore.

    // print failures
    for failed_test in test_results
        .iter()
        .filter(|t| !t.test_command_result.success)
    {
        failed_test.print_failure()
    }

    // print test result summary
    println!("\nTest results:");
    for test_result in &test_results {
        test_result.print_outcome()
    }

    if failed {
        Err(anyhow::anyhow!("Some tests have failed"))
    } else {
        Ok(())
    }
}

/// Prepare and run the integration test
async fn run_integration_test(
    test_directory: PathBuf,
    ipfs_uri: String,
    graph_node_uri: String,
    subgraph_name: String,
) -> anyhow::Result<IntegrationTestSummary> {

    let test_recipe = IntegrationTestRecipe {
        ipfs_uri,
        graph_node_uri,
        subgraph_name
        test_directory,
    };

    println!("Test started: {}", basename(&test_recipe.test_directory));
    let result = run_test_command(&test_recipe).await?;

    Ok(IntegrationTestSummary {
        test_recipe,
        test_command_result: result,
    })
}

/// Runs a command for a integration test
async fn run_test_command(
    test_recipe: &IntegrationTestRecipe,
) -> anyhow::Result<IntegrationTestResult> {
    let output = Command::new("yarn")
        .arg("neon")
        .env("GRAPH_NODE_ADMIN_URI", &test_recipe.graph_node_uri)
        .env("IPFS_URI", &test_recipe.ipfs_uri)
        .env("SUBGRAPH_NAME", &test_recipe.subgraph_name)
        .current_dir(&test_recipe.test_directory)
        .output()
        .await
        .context("failed to run test command")?;

    let test_name = test_recipe.test_name();
    let stdout_tag = format!("[{}:stdout] ", test_name);
    let stderr_tag = format!("[{}:stderr] ", test_name);

    Ok(IntegrationTestResult {
        _exit_status_code: output.status.code(),
        success: output.status.success(),
        output: Output {
            stdout: Some(pretty_output(&output.stdout, &stdout_tag)),
            stderr: Some(pretty_output(&output.stderr, &stderr_tag)),
        },
    })
}

/// run yarn to build everything
async fn run_yarn_command(base_directory: &impl AsRef<Path>) {
    let timer = std::time::Instant::now();
    println!("Running `yarn` command in integration tests root directory.");
    let output = Command::new("yarn")
        .current_dir(base_directory)
        .output()
        .await
        .expect("failed to run yarn command");

    if output.status.success() {
        println!("`yarn` command finished in {}s", timer.elapsed().as_secs());
        return;
    }
    println!("Yarn command failed.");
    println!("{}", pretty_output(&output.stdout, "[yarn:stdout]"));
    println!("{}", pretty_output(&output.stderr, "[yarn:stderr]"));
    panic!("Yarn command failed.")
}

fn parse_numeric_environment_variable(environment_variable_name: &str) -> Option<u64> {
    std::env::var(environment_variable_name)
        .ok()
        .and_then(|x| x.parse().ok())
}
