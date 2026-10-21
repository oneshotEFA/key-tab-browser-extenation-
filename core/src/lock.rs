use std::time::{Duration, Instant};

pub const MAX_SESSION_DURATION: Duration = Duration::from_secs(30 * 60);
pub const DEFAULT_INACTIVITY_TIMEOUT: Duration = Duration::from_secs(5 * 60);
pub const MIN_INACTIVITY_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy)]
pub struct LockConfig {
    pub inactivity_timeout: Duration,
    pub max_session: Duration,
    pub lock_on_os_lock: bool,
}

impl Default for LockConfig {
    fn default() -> Self {
        Self { inactivity_timeout: DEFAULT_INACTIVITY_TIMEOUT, max_session: MAX_SESSION_DURATION, lock_on_os_lock: true }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum LockStateError {
    #[error("already locked")] AlreadyLocked,
    #[error("already unlocked")] AlreadyUnlocked,
    #[error("session expired")] SessionExpired,
    #[error("inactivity timeout")] InactivityTimeout,
    #[error("OS locked")] OsLocked,
    #[error("auth cancelled")] AuthCancelled,
}

#[derive(Debug)]
pub struct LockState {
    config: LockConfig,
    unlocked_at: Option<Instant>,
    last_activity: Option<Instant>,
    locked: bool,
}

impl LockState {
    pub fn new(config: LockConfig) -> Self {
        Self { config, unlocked_at: None, last_activity: None, locked: true }
    }

    pub fn is_locked(&self) -> bool { self.locked }

    pub fn unlock(&mut self, now: Instant) -> Result<(), LockStateError> {
        if !self.locked { return Err(LockStateError::AlreadyUnlocked); }
        self.locked = false;
        self.unlocked_at = Some(now);
        self.last_activity = Some(now);
        Ok(())
    }

    pub fn lock(&mut self) -> Result<(), LockStateError> {
        if self.locked { return Err(LockStateError::AlreadyLocked); }
        self.locked = true;
        self.unlocked_at = None;
        self.last_activity = None;
        Ok(())
    }

    pub fn note_activity(&mut self, now: Instant) {
        if !self.locked { self.last_activity = Some(now); }
    }

    pub fn on_os_lock(&mut self) -> Result<(), LockStateError> {
        if !self.config.lock_on_os_lock { return Ok(()); }
        if self.locked { return Err(LockStateError::AlreadyLocked); }
        self.locked = true;
        self.unlocked_at = None;
        self.last_activity = None;
        Ok(())
    }

    pub fn check_and_lock(&mut self, now: Instant) -> Option<LockStateError> {
        if self.locked { return None; }
        let unlocked_at = self.unlocked_at?;
        if now.duration_since(unlocked_at) >= self.config.max_session {
            let _ = self.lock();
            return Some(LockStateError::SessionExpired);
        }
        if let Some(last) = self.last_activity {
            if now.duration_since(last) >= self.config.inactivity_timeout {
                let _ = self.lock();
                return Some(LockStateError::InactivityTimeout);
            }
        }
        None
    }

    pub fn ms_until_lock(&self, now: Instant) -> Option<u64> {
        if self.locked { return None; }
        let unlocked_at = self.unlocked_at?;
        let session_remaining = self.config.max_session.saturating_sub(now.duration_since(unlocked_at));
        let inactivity_remaining = self.last_activity
            .map(|last| self.config.inactivity_timeout.saturating_sub(now.duration_since(last)))
            .unwrap_or(session_remaining);
        Some(session_remaining.min(inactivity_remaining).as_millis() as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test] fn starts_locked() { assert!(LockState::new(LockConfig::default()).is_locked()); }

    #[test] fn unlock_lock_roundtrip() {
        let mut s = LockState::new(LockConfig::default());
        let now = Instant::now();
        s.unlock(now).unwrap();
        assert!(!s.is_locked());
        s.lock().unwrap();
        assert!(s.is_locked());
    }

    #[test] fn inactivity_locks() {
        let mut s = LockState::new(LockConfig { inactivity_timeout: Duration::from_secs(60), max_session: Duration::from_secs(1800), lock_on_os_lock: true });
        let start = Instant::now();
        s.unlock(start).unwrap();
        s.note_activity(start + Duration::from_secs(59));
        assert!(s.check_and_lock(start + Duration::from_secs(59)).is_none());
        // 61s after last activity (at 59s) — should lock. Do NOT call note_activity first.
        assert!(matches!(s.check_and_lock(start + Duration::from_secs(120)), Some(LockStateError::InactivityTimeout)));
    }

    #[test] fn session_cap_locks() {
        let mut s = LockState::new(LockConfig { inactivity_timeout: Duration::from_secs(3600), max_session: Duration::from_secs(60), lock_on_os_lock: true });
        let start = Instant::now();
        s.unlock(start).unwrap();
        s.note_activity(start + Duration::from_secs(61));
        assert!(matches!(s.check_and_lock(start + Duration::from_secs(61)), Some(LockStateError::SessionExpired)));
    }

    #[test] fn os_lock_forces() {
        let mut s = LockState::new(LockConfig::default());
        s.unlock(Instant::now()).unwrap();
        s.on_os_lock().unwrap();
        assert!(s.is_locked());
    }
}
