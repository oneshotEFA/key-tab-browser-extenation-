use std::process::ExitCode;
mod handler;
mod logging;
mod messaging;
use handler::Handler;
use keytap_core::protocol::{ErrorCode, ErrorPayload, NativeHostResponse, ProtocolError};
use messaging::{extract_id_lenient, read_message, write_response};

fn main() -> ExitCode {
    logging::init();
    tracing::info!("keytap native host starting (pid={})", std::process::id());
    let stdin = std::io::stdin(); let stdout = std::io::stdout();
    let mut si = stdin.lock(); let mut so = stdout.lock();
    let mut handler = Handler::new();
    tracing::info!("handler initialized");
    loop {
        let raw = match read_message(&mut si) {
            Ok(r) => r,
            Err(e) if is_eof(&e) => { tracing::info!("stdin closed"); return ExitCode::SUCCESS; }
            Err(e) => { tracing::error!("stdin read: {e}"); return ExitCode::FAILURE; }
        };
        match keytap_core::protocol::parse_request(&raw) {
            Ok((id, req)) => {
                let resp = handler.handle(req);
                if let Err(e) = write_response(&mut so, &id, &resp) { tracing::error!("write: {e}"); return ExitCode::FAILURE; }
            }
            Err(ProtocolError::Io(e)) if is_eof(&e) => return ExitCode::SUCCESS,
            Err(e) => {
                let id = extract_id_lenient(&raw).unwrap_or_else(|| "unknown".into());
                let resp = NativeHostResponse::Error(ErrorPayload { code: error_code_for(&e), message: e.to_string(), retryable: false });
                if let Err(e) = write_response(&mut so, &id, &resp) { tracing::error!("err write: {e}"); return ExitCode::FAILURE; }
            }
        }
    }
}

fn error_code_for(e: &ProtocolError) -> ErrorCode {
    match e {
        ProtocolError::VersionMismatch { .. } => ErrorCode::ProtocolVersionMismatch,
        ProtocolError::Io(_) => ErrorCode::HostUnavailable,
        _ => ErrorCode::InvalidRequest,
    }
}

fn is_eof(e: &std::io::Error) -> bool { matches!(e.kind(), std::io::ErrorKind::UnexpectedEof | std::io::ErrorKind::BrokenPipe) }
