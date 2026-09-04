# D4 screenshots

SOW §6.1 D4 asks for **one approved intent showing the full chain** and **one refused**
**intent showing its reason code**. The first two files below are those two. The rest
are here because a reviewer scoring the refusal path will want more than one example.

All were captured from <https://aegis-production-2216.up.railway.app> by Chrome/152.0.7977.82 during the run recorded
in `../d4-console-verification.json`, at a 1280px viewport, 2× device pixel ratio,
full page height. Nothing is cropped and nothing is annotated.

| File | Page | Verdict | Reason code | Size |
| --- | --- | --- | --- | ---: |
| `approved-full-chain.png` | <https://aegis-production-2216.up.railway.app/intent/9a9ebd5efcd76521bd822db194815ea1d892a2860c953aa010ba34c9aab9cf2a> | Approved | `Ok` | 1280×4028 css px |
| `refused-owner-rejected.png` | <https://aegis-production-2216.up.railway.app/decision/03defcb77539553dac3b4d96ed2b6e6c31aa57b999da307dc2b67c62d125cee7> | Rejected | `OwnerRejected` | 1280×3732 css px |
| `refused-agent-revoked.png` | <https://aegis-production-2216.up.railway.app/decision/2950696a1a3ab5005a1e378d45ed1e64e4f773152208450d78724fa6547a72f8> | Rejected | `AgentRevoked` | 1280×3214 css px |
| `refused-cap-exceeded.png` | <https://aegis-production-2216.up.railway.app/decision/c942b69f7af06b0172aa39f81e3e42412a9b83c4b8fbfdebe0b9411d314b9db2> | Rejected | `CapExceeded` | 1280×3294 css px |
| `home.png` | <https://aegis-production-2216.up.railway.app/> | — | — | 1280×1600 css px |

## Why these references

**`approved-full-chain.png`** — D2 case s10 — approved after the owner's on-chain resolve(), then settled.

**`refused-owner-rejected.png`** — D2 case s15 — escalated by policy, then declined by hand: OwnerRejected.

**`refused-agent-revoked.png`** — D1 run 58 — a revoked agent asking for 9999.9999999 EURC from an unlisted service: every other rule is broken too, and the contract still answers AgentRevoked.

**`refused-cap-exceeded.png`** — D2 case s11 — above the per-intent cap.

**`home.png`** — the lookup form a reviewer lands on.

The refusal chosen for the mandatory pair is `OwnerRejected`, not the blandest one
available. It is the case where **no policy rule refused the intent**: the contract
escalated it because it sat above `approval_threshold` but under `per_intent_cap`, a
human declined it, and `resolve()` wrote that refusal to the chain. The page shows
both the final `reason_code` (`OwnerRejected`) and the `original_reason_code`
(`PendingApproval`) that the contract kept and never rewrote — so the ledger itself
records that a human was required, and what they decided.

A refusal is rendered with the same box, type scale and space as an approval; only the
hue differs. That is deliberate (`apps/console/src/labels.ts`): refusing correctly is
the outcome the product sells, not a failure to approve.

## What a screenshot catches that an `innerText` check cannot

An earlier run of these images recorded a real cosmetic defect: `Field` in
`apps/console/src/ui.tsx` gave the label column a fixed `13rem`, and the longer
labels — `original_reason_code`, `resolved_policy_version`, `cumulative_window_cap` —
plus their source badge overflowed the `<dt>` and printed on top of the value beside
it. Every automated page read passed throughout, because the values were intact in
the DOM the whole time. Only the pictures showed it.

The label side now wraps inside its track, so these images show it resolved. The
point is kept because it is the honest limit of the method above: 80 correct
`innerText` reads say nothing about whether a human can read the page, and the
screenshots are in this pack unretouched and uncropped for that reason.
