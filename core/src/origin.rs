use url::Url;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OriginCheck {
    pub authorized: bool,
    pub reason: AuthorizationReason,
    pub registrable_domain: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthorizationReason {
    ExactMatch, AdditionalOriginMatch, OriginMismatch, InsecureOrigin, InvalidOrigin,
}

#[derive(Debug, thiserror::Error)]
pub enum OriginError {
    #[error("invalid origin: {0}")] Invalid(String),
    #[error("insecure origin: {0}")] Insecure(String),
}

pub fn check_origin(active: &str, account: &str, additional: &[String]) -> OriginCheck {
    if !is_secure_https_origin(active) {
        let reason = if is_http(active) { AuthorizationReason::InsecureOrigin } else { AuthorizationReason::InvalidOrigin };
        return OriginCheck { authorized: false, reason, registrable_domain: None };
    }
    if origins_equal(active, account) {
        return OriginCheck { authorized: true, reason: AuthorizationReason::ExactMatch, registrable_domain: registrable_domain_of(active) };
    }
    if additional.iter().any(|o| origins_equal(active, o)) {
        return OriginCheck { authorized: true, reason: AuthorizationReason::AdditionalOriginMatch, registrable_domain: registrable_domain_of(active) };
    }
    OriginCheck { authorized: false, reason: AuthorizationReason::OriginMismatch, registrable_domain: registrable_domain_of(active) }
}

pub fn origins_equal(a: &str, b: &str) -> bool {
    match (Url::parse(a), Url::parse(b)) {
        (Ok(ua), Ok(ub)) => ua.scheme() == ub.scheme() && ua.host_str() == ub.host_str() && ua.port_or_known_default() == ub.port_or_known_default(),
        _ => a == b,
    }
}

pub fn is_secure_https_origin(origin: &str) -> bool {
    let Ok(u) = Url::parse(origin) else { return false };
    if u.scheme() != "https" { return false; }
    if !u.username().is_empty() || u.password().is_some() { return false; }
    if u.path() != "/" || u.query().is_some() || u.fragment().is_some() { return false; }
    u.host_str().is_some()
}

fn is_http(origin: &str) -> bool {
    Url::parse(origin).map(|u| u.scheme() == "http").unwrap_or(false)
}

pub fn registrable_domain_of(origin: &str) -> Option<String> {
    let u = Url::parse(origin).ok()?;
    let host = u.host_str()?;
    Some(host.strip_prefix("www.").unwrap_or(host).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test] fn exact_match() { assert!(check_origin("https://github.com", "https://github.com", &[]).authorized); }
    #[test] fn additional_origin() { assert!(check_origin("https://gist.github.com", "https://github.com", &["https://gist.github.com".into()]).authorized); }
    #[test] fn same_etld_rejected() { assert!(!check_origin("https://evil.example.com", "https://login.example.com", &[]).authorized); }
    #[test] fn http_rejected() { assert!(!check_origin("http://github.com", "https://github.com", &[]).authorized); }
    #[test] fn path_rejected() { assert!(!check_origin("https://github.com/login", "https://github.com", &[]).authorized); }
    #[test] fn port_normalized() { assert!(check_origin("https://github.com:443", "https://github.com", &[]).authorized); }
    #[test] fn non_default_port_rejected() { assert!(!check_origin("https://github.com:8443", "https://github.com", &[]).authorized); }
    #[test] fn garbage_rejected() { assert!(!check_origin("not a url", "https://github.com", &[]).authorized); }
}
