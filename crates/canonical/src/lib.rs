//! Rust implementation of the AEGIS canonical serialization spec.
//!
//! Mirrors `packages/canonical` (TypeScript). Both **assert against**
//! `vectors/canonical-vectors.json` — see `packages/canonical/SPEC.md`.
//!
//! A single byte of divergence between the two turns CI red in Week 1, not Week 4.

use sha2::{Digest, Sha256};

pub const INTENT_DOMAIN: &[u8] = b"AEGIS-INTENT-v1";
pub const DECISION_DOMAIN: &[u8] = b"AEGIS-DECISION-v1";

/// 1 asset unit = 10^7 stroops (Stellar uses 7 decimal places).
pub const STROOPS_PER_UNIT: i128 = 10_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Intent {
    pub agent_id: String,
    pub service_id: String,
    /// of the form "CODE:ISSUER"
    pub asset: String,
    /// in stroops, must be > 0
    pub amount: i128,
    pub purpose: String,
    pub client_ref: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum CanonError {
    Str8TooLong(usize),
    Str16TooLong(usize),
    NonPositiveAmount(i128),
}

fn push_str8(out: &mut Vec<u8>, s: &str) -> Result<(), CanonError> {
    let b = s.as_bytes();
    if b.len() > u8::MAX as usize {
        return Err(CanonError::Str8TooLong(b.len()));
    }
    out.push(b.len() as u8);
    out.extend_from_slice(b);
    Ok(())
}

fn push_str16(out: &mut Vec<u8>, s: &str) -> Result<(), CanonError> {
    let b = s.as_bytes();
    if b.len() > u16::MAX as usize {
        return Err(CanonError::Str16TooLong(b.len()));
    }
    out.extend_from_slice(&(b.len() as u16).to_be_bytes());
    out.extend_from_slice(b);
    Ok(())
}

/// Fixed byte layout — see SPEC.md §1.
///
/// Input strings must already be in NFC. Rust `String` does not normalize on its own,
/// so the gateway (TS) is responsible for normalizing before sending.
pub fn canonical_intent(i: &Intent) -> Result<Vec<u8>, CanonError> {
    if i.amount <= 0 {
        return Err(CanonError::NonPositiveAmount(i.amount));
    }
    let mut out = Vec::with_capacity(128);
    out.extend_from_slice(INTENT_DOMAIN);
    push_str8(&mut out, &i.agent_id)?;
    push_str8(&mut out, &i.service_id)?;
    push_str8(&mut out, &i.asset)?;
    out.extend_from_slice(&i.amount.to_be_bytes());
    push_str16(&mut out, &i.purpose)?;
    push_str8(&mut out, &i.client_ref)?;
    Ok(out)
}

pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

pub fn intent_hash(i: &Intent) -> Result<[u8; 32], CanonError> {
    Ok(sha256(&canonical_intent(i)?))
}

/// `sha256(intent_hash[32] || policy_version_be_u32[4] || decision_id[32])` — 68 byte preimage.
/// Matches the §6.3 acceptance criteria verbatim.
pub fn memo_hash(intent_hash: &[u8; 32], policy_version: u32, decision_id: &[u8; 32]) -> [u8; 32] {
    let mut pre = Vec::with_capacity(68);
    pre.extend_from_slice(intent_hash);
    pre.extend_from_slice(&policy_version.to_be_bytes());
    pre.extend_from_slice(decision_id);
    sha256(&pre)
}

/// ⚠️ ABI NOT YET FINALIZED — see DECISIONS.md #4.
pub fn decision_id(intent_hash: &[u8; 32], policy_version: u32) -> [u8; 32] {
    let mut pre = Vec::with_capacity(53);
    pre.extend_from_slice(DECISION_DOMAIN);
    pre.extend_from_slice(intent_hash);
    pre.extend_from_slice(&policy_version.to_be_bytes());
    sha256(&pre)
}

pub fn to_hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
