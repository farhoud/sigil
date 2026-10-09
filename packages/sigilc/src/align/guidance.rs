//! Compiled code guidance, independent of the design guidance fingerprint.
use crate::sources::hash;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Document {
    pub name: &'static str,
    pub text: &'static str,
}

pub const BUNDLE: &[Document] = &[
    Document {
        name: "rows.md",
        text: include_str!("guidance/rows.md"),
    },
    Document {
        name: "examples.md",
        text: include_str!("guidance/examples.md"),
    },
    Document {
        name: "rejected.md",
        text: include_str!("guidance/rejected.md"),
    },
];

// @sigil implements packages/sigilc/align.sigil::SigilImplementationClaims::CodeGuidance interface
pub fn fingerprint() -> String {
    hash(
        concat!(
            include_str!("guidance/rows.md"),
            include_str!("guidance/examples.md"),
            include_str!("guidance/rejected.md"),
            include_str!("vocabulary.rs"),
            include_str!("laws.egg")
        )
        .as_bytes(),
    )
}

pub fn extract(out: &Path, workspace_root: &Path) -> Result<Vec<PathBuf>, String> {
    if contains(workspace_root, out)? {
        return Err(format!(
            "refusing to write guidance inside the workspace under validation: {}",
            out.display()
        ));
    }
    std::fs::create_dir_all(out).map_err(|e| format!("{}: {e}", out.display()))?;
    let mut written = Vec::new();
    for doc in BUNDLE {
        let path = out.join(doc.name);
        std::fs::write(&path, doc.text).map_err(|e| format!("{}: {e}", path.display()))?;
        written.push(path);
    }
    Ok(written)
}

/// Whether `inner` resolves to `root` or somewhere beneath it.
///
/// Resolves the nearest existing ancestor, because the destination usually does
/// not exist yet; a purely lexical comparison would be defeated by `..`.
fn contains(root: &Path, inner: &Path) -> Result<bool, String> {
    let root = resolve(root)?;
    let inner = resolve(inner)?;
    Ok(inner.starts_with(&root))
}

fn resolve(path: &Path) -> Result<PathBuf, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(path)
    };
    let mut existing = absolute.as_path();
    let mut tail = Vec::new();
    loop {
        match existing.canonicalize() {
            Ok(mut resolved) => {
                for part in tail.iter().rev() {
                    resolved.push(part);
                }
                return Ok(resolved);
            }
            Err(_) => match existing.parent() {
                Some(parent) => {
                    match existing.file_name() {
                        Some(name) => tail.push(name.to_owned()),
                        // A root or prefix component cannot be canonicalized and
                        // has no file name; fall back to the lexical form.
                        None => return Ok(normalize(&absolute)),
                    }
                    existing = parent;
                }
                None => return Ok(normalize(&absolute)),
            },
        }
    }
}

fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}
