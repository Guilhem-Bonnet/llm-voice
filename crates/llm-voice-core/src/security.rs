//! Contrôles de la boucle locale (ADR-012 §6) : jeton, `Origin`, `Host`.

use rand::distributions::Alphanumeric;
use rand::Rng;

/// Longueur du jeton généré (alphanumérique, ~190 bits d'entropie).
pub const TOKEN_LEN: usize = 32;

/// Jeton de session aléatoire (`rand::thread_rng`, CSPRNG ChaCha).
pub fn generate_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(TOKEN_LEN)
        .map(char::from)
        .collect()
}

/// Comparaison en temps constant (pour la longueur donnée) : ne révèle pas le
/// préfixe commun par le temps de réponse.
pub fn token_matches(candidate: &str, expected: &str) -> bool {
    let (a, b) = (candidate.as_bytes(), expected.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// `Host` accepté : `127.0.0.1:<port>` ou `localhost:<port>` exactement
/// (parade au rebinding DNS).
pub fn host_is_allowed(host: Option<&str>, port: u16) -> bool {
    match host {
        Some(host) => host == format!("127.0.0.1:{port}") || host == format!("localhost:{port}"),
        None => false,
    }
}

/// `Origin` accepté : absent ou vide. Tout `Origin` non vide vient d'un
/// navigateur (page web, webview) : refusé, le Core n'a aucun client web.
pub fn origin_is_allowed(origin: Option<&str>) -> bool {
    origin.map(str::trim).is_none_or(str::is_empty)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_tokens_are_long_random_and_distinct() {
        let a = generate_token();
        let b = generate_token();
        assert_eq!(a.len(), TOKEN_LEN);
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric()));
        assert_ne!(a, b);
    }

    #[test]
    fn token_comparison() {
        assert!(token_matches("abcdefghijklmnop", "abcdefghijklmnop"));
        assert!(!token_matches("abcdefghijklmnoq", "abcdefghijklmnop"));
        assert!(!token_matches("abc", "abcdefghijklmnop"));
        assert!(!token_matches("", "abcdefghijklmnop"));
    }

    #[test]
    fn host_and_origin_rules() {
        assert!(host_is_allowed(Some("127.0.0.1:4000"), 4000));
        assert!(host_is_allowed(Some("localhost:4000"), 4000));
        assert!(!host_is_allowed(Some("127.0.0.1:4001"), 4000));
        assert!(!host_is_allowed(Some("evil.example:4000"), 4000));
        assert!(!host_is_allowed(None, 4000));
        assert!(origin_is_allowed(None));
        assert!(origin_is_allowed(Some("")));
        assert!(!origin_is_allowed(Some("https://evil.example")));
        assert!(!origin_is_allowed(Some("vscode-webview://abc")));
    }
}
