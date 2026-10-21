# Product

## Register

product

## Users

People using a browser extension to fill one-time 2FA codes into the site they are currently visiting. They are usually in a time-sensitive sign-in flow and need confidence that the selected account and destination are correct.

## Product Purpose

Keytap is a local-first TOTP autofill tool. Its popup should make the current website, available matching accounts, code state, and Fill action immediately understandable. Success means a user can open the popup, identify the right account, and fill the code without hunting through controls or worrying that the wrong site will receive it.

## Brand Personality

Calm, private, dependable. The interface should feel like a focused utility: clear enough to trust, compact enough to stay out of the way, and explicit about security-sensitive states.

## Anti-references

Avoid crypto-wallet styling, dashboard clutter, decorative gradients, tiny low-contrast labels, and ambiguous icon-only actions. Do not make the user decode whether an account matches the current site or whether Fill is available.

## Design Principles

- Lead with context: show the current site and whether it is recognized.
- Make the safe action obvious: matching accounts get a clear, high-contrast Fill action.
- Keep sensitive information controlled: reveal codes deliberately and label their expiry.
- Prefer useful density over decoration: every row should support scan, verify, and act.
- Explain blocked states inline instead of leaving users guessing.

## Accessibility & Inclusion

Support keyboard navigation, visible focus states, readable contrast, semantic buttons and labels, reduced motion, and layouts that remain usable at compact popup widths. Color must not be the only way to communicate match, warning, or error state.
