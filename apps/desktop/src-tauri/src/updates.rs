//! Tells the user when a newer release is out. Checking only: downloading and
//! installing belongs to the in-app updater, which is not built yet.
//!
//! GitHub's API gets its own client rather than going through `Http`, whose
//! allowlist stays closed to everything but YouTube.

use std::time::Duration;

use semver::Version;
use serde::{Deserialize, Serialize};

const RELEASES: &str = "https://api.github.com/repos/TonybynMp4/yMusic/releases?per_page=20";

/// A release newer than the running build.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub version: String,
    pub url: String,
    pub prerelease: bool,
}

#[derive(Debug, Deserialize)]
pub struct GitHubRelease {
    tag_name: String,
    html_url: String,
    draft: bool,
    prerelease: bool,
}

pub async fn check(current: &Version, include_prereleases: bool) -> Result<Option<Update>, String> {
    let client = reqwest::Client::builder()
        .user_agent(format!("yMusic/{current}"))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?;
    let body = client
        .get(RELEASES)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| format!("could not check for updates: {error}"))?
        .bytes()
        .await
        .map_err(|error| format!("could not check for updates: {error}"))?;
    let releases: Vec<GitHubRelease> = serde_json::from_slice(&body)
        .map_err(|error| format!("unexpected answer from GitHub: {error}"))?;
    Ok(newest(releases, current, include_prereleases))
}

/// The newest release above `current`, skipping drafts, tags that are not
/// versions, and prereleases unless asked for.
pub fn newest(
    releases: Vec<GitHubRelease>,
    current: &Version,
    include_prereleases: bool,
) -> Option<Update> {
    releases
        .into_iter()
        .filter(|release| !release.draft && (include_prereleases || !release.prerelease))
        .filter_map(|release| {
            let version = Version::parse(release.tag_name.trim_start_matches('v')).ok()?;
            Some((version, release))
        })
        .filter(|(version, _)| version > current)
        .max_by(|(a, _), (b, _)| a.cmp(b))
        .map(|(version, release)| Update {
            version: version.to_string(),
            url: release.html_url,
            prerelease: release.prerelease,
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag: &str, prerelease: bool) -> GitHubRelease {
        GitHubRelease {
            tag_name: tag.into(),
            html_url: format!("https://github.com/TonybynMp4/yMusic/releases/tag/{tag}"),
            draft: false,
            prerelease,
        }
    }

    fn releases() -> Vec<GitHubRelease> {
        vec![
            release("v0.4.0-beta.1", true),
            release("v0.3.0", false),
            release("v0.2.0", false),
            release("nightly", true),
        ]
    }

    #[test]
    fn finds_the_newest_stable_release() {
        let current = Version::new(0, 2, 0);
        let update = newest(releases(), &current, false).unwrap();
        assert_eq!(update.version, "0.3.0");
        assert!(update.url.ends_with("/v0.3.0"));
    }

    #[test]
    fn prereleases_only_when_asked() {
        let current = Version::new(0, 3, 0);
        assert_eq!(newest(releases(), &current, false), None);
        assert_eq!(
            newest(releases(), &current, true).unwrap().version,
            "0.4.0-beta.1"
        );
    }

    #[test]
    fn nothing_when_up_to_date() {
        assert_eq!(newest(releases(), &Version::new(0, 4, 0), true), None);
    }
}
