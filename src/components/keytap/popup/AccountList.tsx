/**
 * AccountList — filtered, origin-prioritized list of accounts.
 *
 * Matching accounts (origin === activeTabOrigin, or in additionalOrigins)
 * bubble to the top with a divider before the rest.
 *
 * Search filter matches issuer / label / origin (case-insensitive substring).
 */

import { useMemo } from "react";
import type { PopupAccount, PopupOtp } from "./types";
import { AccountRow } from "./AccountRow";

export function AccountList({
  accounts,
  codes,
  now,
  activeOrigin,
  search,
  onReveal,
  onFill,
  onDelete,
  onEditOrigin,
}: {
  accounts: PopupAccount[];
  codes: Map<string, PopupOtp>;
  now: number;
  activeOrigin: string | null;
  search: string;
  onReveal: (account: PopupAccount) => void;
  onFill: (account: PopupAccount) => void;
  onDelete: (account: PopupAccount) => void;
  onEditOrigin?: (account: PopupAccount) => void;
}) {
  const { matching, others } = useMemo(() => {
    const filtered = accounts.filter((a) => matchSearch(a, search));
    const matching: PopupAccount[] = [];
    const others: PopupAccount[] = [];
    for (const a of filtered) {
      if (activeOrigin && originMatches(a, activeOrigin)) matching.push(a);
      else others.push(a);
    }
    // Stable sort within each bucket by issuer then label.
    matching.sort(compareAccounts);
    others.sort(compareAccounts);
    return { matching, others };
  }, [accounts, search, activeOrigin]);

  if (accounts.length === 0) {
    return (
      <EmptyState
        title="No accounts yet"
        body="Use the + button above to add an account, then return to this site to fill its code."
      />
    );
  }

  if (matching.length === 0 && others.length === 0) {
    return (
      <EmptyState
        title="No matches"
        body={`Nothing matches “${search}”. Clear the search to see all accounts.`}
      />
    );
  }

  return (
    <ul className="space-y-2 px-3 py-3">
      {matching.map((a) => (
        <AccountRow
          key={a.id}
          account={a}
          otp={codes.get(a.id) ?? null}
          now={now}
          originMatch={!!activeOrigin && originMatches(a, activeOrigin)}
          onReveal={onReveal}
          onFill={onFill}
          onDelete={onDelete}
          onEditOrigin={onEditOrigin}
        />
      ))}
      {matching.length > 0 && others.length > 0 && (
        <li className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
          Other accounts
        </li>
      )}
      {others.map((a) => (
        <AccountRow
          key={a.id}
          account={a}
          otp={codes.get(a.id) ?? null}
          now={now}
          originMatch={false}
          onReveal={onReveal}
          onFill={onFill}
          onDelete={onDelete}
          onEditOrigin={onEditOrigin}
        />
      ))}
    </ul>
  );
}

/**
 * Origin match helper (exported for tests + reuse by the preview harness).
 *
 * EXACT match only. Same-eTLD+1 is intentionally NOT considered a match.
 *   originMatches({origin:"https://github.com", allOrigins:["https://gist.github.com"]}, "https://gist.github.com") -> true
 *   originMatches({origin:"https://login.example.com"}, "https://evil.example.com") -> false
 */
export function originMatches(account: PopupAccount, activeOrigin: string): boolean {
  return account.allOrigins.includes(activeOrigin);
}

function matchSearch(a: PopupAccount, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    a.issuer.toLowerCase().includes(needle) ||
    a.label.toLowerCase().includes(needle) ||
    a.origin.toLowerCase().includes(needle) ||
    (a.additionalOrigins?.some((o) => o.toLowerCase().includes(needle)) ?? false)
  );
}

function compareAccounts(a: PopupAccount, b: PopupAccount): number {
  const byIssuer = (a.issuer || "").localeCompare(b.issuer || "");
  if (byIssuer !== 0) return byIssuer;
  return (a.label || "").localeCompare(b.label || "");
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-[11px] text-muted-foreground">{body}</p>
    </div>
  );
}
