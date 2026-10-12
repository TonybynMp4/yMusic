//! Keeping a sign-in window session alive.
//!
//! Google rotates `__Secure-1PSIDTS` in a signed-in browser every few minutes,
//! and after a while stops accepting a copy that was never rotated. A session
//! from the sign-in window has no browser left to do that, so the app does it:
//! the same request a browser's accounts frame sends, whose answer sets the
//! new cookies. Never for an imported session: the browser rotates that one,
//! and two holders rotating one session invalidate each other's copy.
//!
//! The endpoint is undocumented. youtube.com rotates through
//! `accounts.youtube.com`; clients of Google's other web apps post the same
//! body to `accounts.google.com`. Both are tried, in that order, and what each
//! answered is logged (statuses and cookie names, never values).

use std::time::Duration;

use reqwest::header::{CONTENT_TYPE, COOKIE, ORIGIN, SET_COOKIE};

const ENDPOINTS: [(&str, &str); 2] = [
    (
        "https://accounts.youtube.com/RotateCookies",
        "https://accounts.youtube.com",
    ),
    (
        "https://accounts.google.com/RotateCookies",
        "https://accounts.google.com",
    ),
];
const BODY: &str = r#"[000,"-0000000000000000000"]"#;
const ROTATED: &str = "__Secure-1PSIDTS";

/// The cookie header with the rotated cookies in, or None if no endpoint
/// rotated it.
pub async fn rotate(cookie: &str) -> Result<Option<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| error.to_string())?;
    for (url, origin) in ENDPOINTS {
        let response = match client
            .post(url)
            .header(CONTENT_TYPE, "application/json")
            .header(ORIGIN, origin)
            .header(COOKIE, cookie)
            .body(BODY)
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                log::warn!("rotating the session at {url}: {error}");
                continue;
            }
        };
        let set: Vec<SetCookie> = response
            .headers()
            .get_all(SET_COOKIE)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .filter_map(SetCookie::parse)
            .collect();
        log::info!(
            "rotating the session at {url}: HTTP {}, set {}",
            response.status().as_u16(),
            set.iter()
                .map(SetCookie::describe)
                .collect::<Vec<_>>()
                .join(" ")
        );
        if set.iter().any(|c| c.name == ROTATED && c.value.is_some()) {
            return Ok(Some(merge(cookie, &set)));
        }
    }
    Ok(None)
}

#[derive(Debug, PartialEq)]
struct SetCookie {
    name: String,
    domain: Option<String>,
    /// None when the header deletes the cookie.
    value: Option<String>,
}

impl SetCookie {
    fn parse(header: &str) -> Option<Self> {
        let mut parts = header.split(';');
        let (name, value) = parts.next()?.trim().split_once('=')?;
        let mut domain = None;
        let mut deleted = value.is_empty();
        for attribute in parts {
            let attribute = attribute.trim();
            let (key, val) = attribute.split_once('=').unwrap_or((attribute, ""));
            match key.to_ascii_lowercase().as_str() {
                "domain" => domain = Some(val.to_string()),
                "max-age" => deleted |= val.trim().parse::<i64>().is_ok_and(|age| age <= 0),
                "expires" => deleted |= val.contains("1970"),
                _ => {}
            }
        }
        Some(Self {
            name: name.to_string(),
            domain,
            value: (!deleted).then(|| value.to_string()),
        })
    }

    fn describe(&self) -> String {
        let domain = self.domain.as_deref().unwrap_or("host");
        let deleted = if self.value.is_none() {
            " (deleted)"
        } else {
            ""
        };
        format!("{}@{domain}{deleted}", self.name)
    }
}

/// Replaces the cookies the answer set and appends new ones. Deletions are
/// left alone: dropping a cookie from the session is not worth the risk.
fn merge(cookie: &str, set: &[SetCookie]) -> String {
    let mut jar: Vec<(String, String)> = cookie
        .split(';')
        .filter_map(|pair| pair.trim().split_once('='))
        .map(|(name, value)| (name.to_string(), value.to_string()))
        .collect();
    for SetCookie { name, value, .. } in set {
        let Some(value) = value else { continue };
        match jar.iter_mut().find(|(existing, _)| existing == name) {
            Some(entry) => entry.1 = value.clone(),
            None => jar.push((name.clone(), value.clone())),
        }
    }
    jar.iter()
        .map(|(name, value)| format!("{name}={value}"))
        .collect::<Vec<_>>()
        .join("; ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_set_cookie_header() {
        let set = SetCookie::parse(
            "__Secure-1PSIDTS=new; Domain=.youtube.com; Path=/; Secure; HttpOnly; Max-Age=31536000",
        );
        assert_eq!(
            set,
            Some(SetCookie {
                name: "__Secure-1PSIDTS".into(),
                domain: Some(".youtube.com".into()),
                value: Some("new".into()),
            })
        );
    }

    #[test]
    fn a_past_expiry_is_a_deletion() {
        let set = SetCookie::parse("SIDCC=; Expires=Thu, 01 Jan 1970 00:00:00 GMT").unwrap();
        assert_eq!(set.value, None);
        let set = SetCookie::parse("SIDCC=x; Max-Age=0").unwrap();
        assert_eq!(set.value, None);
    }

    #[test]
    fn merging_replaces_and_appends_but_never_deletes() {
        let set = [
            SetCookie::parse("__Secure-1PSIDTS=new").unwrap(),
            SetCookie::parse("SIDCC=fresh").unwrap(),
            SetCookie::parse("SID=; Max-Age=0").unwrap(),
        ];
        assert_eq!(
            merge("SID=a; __Secure-1PSIDTS=old", &set),
            "SID=a; __Secure-1PSIDTS=new; SIDCC=fresh"
        );
    }
}
