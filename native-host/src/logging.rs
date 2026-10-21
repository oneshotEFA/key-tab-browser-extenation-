use tracing_subscriber::EnvFilter;
pub fn init() {
    let _ = tracing_subscriber::fmt().with_writer(std::io::stderr).with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))).with_target(false).try_init();
}
