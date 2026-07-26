---
last_updated: 2026-07-27
status: normative
---

# Git Leaf app usage analytics specification

## Authority

This is the sole contract for usage analytics in packaged Git Leaf desktop builds. It defines:

- allowed events and statistical fields;
- the product fact represented by each field;
- verifiable event relationships, join keys, and ordering;
- standard reporting, data-quality gates, and prohibited inferences;
- collection, privacy, transport, storage, and retention boundaries;
- the change procedure shared by clients, the Mango Future hosted receiver, the summary tool, and
  operational reports.

Code, tests, heartbeat reports, and ad-hoc analysis must not invent another metric definition. A change
to an event, property, enum, relation, or metric updates this specification first, then client and server
validation, aggregation, and tests. If the source data cannot answer a question, output `N/A` or
`legacy_unknown`; never substitute a nearby metric.

The priority is verifiable and repeatable semantics after a capability boundary, not maximum reuse of
historical records. Preserve old absolute facts without pretending they satisfy a newer contract.

## Scope

- Applies only to packaged, non-development macOS and Windows desktop apps whose analytics build
  eligibility is stable. Public and internal update tracks can both be eligible; a manifest path does
  not define analytics eligibility.
- Does not apply to Community Builds, local development, CI packages, CLI, browser-only entry points, or
  injected test events.
- Raw sources are `events/` and `downloads/` JSONL or JSONL.GZ on the Mango Future receiver.
- Defines product-usage statistics only. It is not an employee-performance, user-profiling, advertising,
  or content-analysis system.
- Repository identity, document identity, searches, Git data, and user identity must not be uploaded to
  improve analytics.

## Collection, privacy, and storage

### Client identity and local computation

- The first eligible launch creates a random UUID `install_id` in telemetry state under Electron
  `userData`. Updates preserve it; deleting user data creates a new identity. Separate operating-system
  user profiles are separate installation instances.
- A device name may appear only on the low-frequency `git_leaf.installation.observed` event and may be
  absent. It is not a deduplication, join, or user key and never appears in daily summaries or update
  events.
- The client generates `repo_secret` and computes
  `repo_local_key = HMAC-SHA256(repo_secret, canonical_git_common_dir)` locally for distinct repository
  counts. The receiver never gets this key, a repository path, a remote, or Git common-dir data.
- Launches, active minutes, distinct repositories, mode minutes, and feature activity accumulate locally
  by day. The receiver gets daily snapshots, not clicks, keystrokes, or minute-by-minute heartbeats.
- A renderer can submit only allowlisted counters to Electron. Electron adds and validates the install
  identity, app version, queue state, and network envelope.
- Analytics is best effort. Initialization, persistence, upload, or receiver failure must not block
  startup, repository access, editing, sync, or update. Exit upload has a hard timeout and leaves the
  queue for later retry.

### Prohibited data

Client event field names and values must not carry these or equivalent data:

```text
repo, repository, repo_root, remote, path, file, filename, document_title,
branch, worktree_id, target_commit, query, content, source, diff, clipboard,
frontmatter_key, frontmatter_value, url, email, username, serial_number, mac_address
```

The receiver-written constant `source=download_page` on `git_leaf.distribution.downloaded` is the only
exception and is not a client property. Errors use allowlisted `error_code` and `stage`, never exception
messages, stacks, stderr, or response bodies. Diagnostic uploads would require a separate feature,
consent decision, store, and retention policy.

### Eligibility, local queue, and transport

- Eligible packaged builds use this baseline without a user setting or device-name setting. Help text
  states what is and is not collected.
- Community, development, test, CI, unpackaged Electron, CLI, and browser builds remain disabled.
- `telemetry-state.json` contains the installation ID, version, device label, anonymous local repository
  state, and daily checkpoints. Queued payloads contain only lifecycle events and daily snapshots.
- Persisted daily state retains only the window needed for the rolling 30-day calculation. State that
  has not safely entered the queue cannot be deleted early.
- A batch contains at most 100 events and at most 64 KiB of uncompressed JSON.
- The first snapshot is queued about two seconds after launch. While values change, the latest revision
  is queued at most once per minute. No change means no empty revision.
- Network failures use exponential backoff capped at six hours. The queue retains at most 30 days or
  1 MiB; a newer revision may replace an older queued revision for the same `summary_id`.
- Normal exit queues the latest snapshot and performs at most 1.5 seconds of best-effort upload. Failure
  preserves the queue and cannot delay exit indefinitely.
- A client may retry the same `event_id`; aggregation deduplicates idempotently.

### Hosted receiver and raw storage

- Client events use HTTPS `POST /telemetry/v1/events`.
- The receiver allowlists event names, feature IDs, properties, enums, lengths, and numeric ranges.
  Unknown fields reject the whole batch.
- The receiver adds `received_at` and rate-limits by request source and `install_id`. Client clocks,
  counters, and versions are not trusted server facts.
- Client events go to `events/`. Completed download-page artifact responses go to `downloads/`.
  Neither is stored with release artifacts.
- A batch is appended line by line under its UTC received date only after every event validates. Write
  failure rejects the whole batch for later client retry.
- JSONL/JSONL.GZ under `events/` and `downloads/` is the only source of truth. Reports must be
  reproducible from these files in the processing order below.

```text
/var/lib/git-leaf/telemetry/
  events/YYYY/MM/DD.jsonl
  downloads/YYYY/MM/DD.jsonl
  reports/
```

### Retention and product disclosure

- Current-day JSONL remains uncompressed. Files may be gzip-compressed after seven days.
- Raw JSONL/JSONL.GZ is retained for 12 months.
- Generated JSON or Markdown reports are retained as needed.
- Reverse-proxy access logs are retained for at most seven days and are not product analytics JSONL.
- Date-based cleanup implements retention. Policy changes update this specification and operations
  configuration first.
- Help states that Git Leaf may send anonymous installation, version, update, active-duration, and
  aggregate feature statistics. It does not send repository names, file names, document content,
  searches, or Git data. A device name is an internal inventory label, not a user identity or behavior
  property.

## Terms and units

| Term | Key or unit | Represents | Does not represent |
| --- | --- | --- | --- |
| Event | `event_id` | One client state record | A person or unique action |
| Installation instance | `install_id` | One retained app data directory | A natural person, physical device, or download |
| Download request | `download_id` | One completed official artifact GET initiated from the download page | A unique person, device, or successful install |
| Daily summary | `summary_id` plus highest `revision` | Latest cumulative snapshot for one installation and `summary_date` | Immutable incremental events |
| Update state group | `install_id` plus `to_version` | Observable states for one target version | A strict update transaction or conversion funnel |
| Active installation | `install_id` | An installation with qualifying launch, activity, or feature evidence | A signed-in user or team member |

External wording uses “installation instance,” not “user.” `reason=first_observed` means a first-observed
installation instance, not a new installation or new user.

## Processing order

Standard aggregation:

1. Read every `.jsonl` and `.jsonl.gz` under `events/` and `downloads/`.
2. Reject records whose schema/version capability is invalid or whose primary key is missing.
3. Group client records by `event_id` and downloads by `download_id`. Keep one identical retry. If one
   key has conflicting content, quarantine every record for that key and count one conflicting key.
4. Recover legacy daily-summary `summary_date`; exclude failures rather than falling back to envelope
   dates.
5. Filter lifecycle/update records by `local_date`, summaries by recovered `summary_date`, and downloads
   by UTC `occurred_at`.
6. Select the globally highest `revision` for each `summary_id` before platform/version slicing.
   Quarantine the whole summary group on a highest-revision or identity conflict.
7. Apply platform and app-version filters only to final daily snapshots. A filter must not resurrect a
   superseded revision.
8. Calculate installation, update, activity, feature, and quality metrics.
9. Output the data window, generation time, latest `received_at`, file counts, and quality warnings.

Without explicit `--from` and `--to`, the CLI uses yesterday in Asia/Shanghai as the end of a 30-complete-
day window. Library calls can retain full-history analysis when no dates are passed. Today is shown
separately as incomplete. With fewer than seven complete source dates, absolute counts are allowed but a
seven-day trend claim is not.

## Event catalog

### `git_leaf.distribution.downloaded`

This event is written by the hosted receiver, not uploaded by the client.

| Field | Allowed value | Fact |
| --- | --- | --- |
| `download_id` | Random short ID | Log primary key |
| `occurred_at` | UTC ISO timestamp | Time the receiver completed request handling |
| `channel` | `stable` | Official distribution channel |
| `platform` | `darwin-universal`, `darwin-arm64`, `win32-x64` | Artifact platform |
| `version` | SemVer | Requested artifact version |
| `artifact` | macOS `dmg`, Windows `zip` | Artifact kind |
| `source` | `download_page` | Request carried the fixed download-page source |
| `bytes` | Nonnegative integer | Artifact file `stat()` size, not transferred bytes |

Interpret only as download-page artifact-request trends. It excludes updater packages, direct artifact
URLs, copied packages, proxy-cache behavior, and requests without the source marker. A missing download
log is “source not formed,” not a confirmed zero.

### `git_leaf.installation.observed`

| Property | Allowed value | Fact |
| --- | --- | --- |
| `reason` | `first_observed` | First entry of this `install_id` into analytics |
| `reason` | `device_name_changed` | Device label changed for the same installation |
| `device_name` | Optional, at most 120 characters | Inventory label only |

`first_observed` can follow a new install, first telemetry-capable upgrade, user-data deletion, or a
rebuilt/copied profile. Downloads and first observations have no join key and cannot form a conversion
rate.

“Observed installation” uses the earliest valid `first_observed` record per `install_id`. Slicing uses
that record's local date, platform, and app version. Later label changes cannot move an installation
between slices; orphaned label-change records do not count as observed installations.

### `git_leaf.update.state_changed`

Common properties:

| Property | Allowed value | Rule |
| --- | --- | --- |
| `state` | State table below | Observable client state |
| `trigger` | `automatic`, `manual`, `windows_bootstrap` | Code path trigger, not user intent |
| `from_version` | SemVer | Running version |
| `to_version` | SemVer or null | Discovered/prepared target |
| `error_code` | Fixed enum | Stable failure class only |
| `stage` | `check`, `download`, `prepare`, `install`, `launch`, `unknown` | Failure stage; missing old data is `legacy_unknown` |

| State | Fact | Restriction |
| --- | --- | --- |
| `check_started` | An update check began | No `attempt_id`; aggregate balance only |
| `current` | Manifest version is not newer | `to_version < from_version` is `feed_behind`, not exact current |
| `available` | A newer manifest was found | May repeat; does not prove visibility or intent |
| `downloaded` | Client reports the package downloaded and prepared | May repeat; not install start |
| `install_started` | The installer entry was invoked before quit/switch | Absence cannot prove no install |
| `completed` | A later local state observed a running-version change | Does not prove in-app installation |
| `failed` | A stable error code was recorded | Analyze by stage and app capability |
| `skipped` | Reserved | Not a core metric |

`automatic` can resume a previously persisted user intent. `completed` currently uses `automatic`; it
must not be attributed as an automatic update.

For current clients:

| State | Required | Omitted |
| --- | --- | --- |
| `check_started` | `trigger`, valid `from_version` | `to_version`, `error_code`, `stage` |
| `current`, `available`, `downloaded`, `install_started`, `completed`, `skipped` | `trigger`, valid `from_version`, valid `to_version` | `error_code`, `stage` |
| `failed` at `check` | `trigger`, valid `from_version`, `error_code`, `stage` | `to_version` optional |
| Other `failed` | `trigger`, valid `from_version`, valid `to_version`, `error_code`, `stage` | none |

These completeness rules apply from App `1.10.0`. Earlier clients may lack stage, error code, or target
version; the receiver accepts valid legacy records and the aggregator reports missing capability as
`legacy_unknown`. Records before `1.10.0` never satisfy strict update relationships merely because they
happen to contain a field. A non-failed state carrying `error_code` or `stage` is contradictory and is
rejected under every capability.

### `git_leaf.daily.summary`

A daily summary is a cumulative snapshot.

| Field | Unit | Meaning |
| --- | --- | --- |
| `summary_date` | Local calendar date | Business date of the cumulative snapshot |
| `launch_count` | Count | App process launches |
| `launch_counts_by_entry_kind` | Count | `manual`, `deep_link`, `update_restart`, `windows_bootstrap`, `unknown` |
| `active_minutes` | Whole minutes | Visible, focused, unlocked, non-idle, non-update-exit minutes |
| `repository_open_count` | Count | Successful repository opens |
| `repository_switch_count` | Count | Switches between repositories |
| `distinct_repository_count` | Repositories | Locally deduplicated repositories that day |
| `rolling_30d_distinct_repository_count` | Repositories | Locally deduplicated repositories over 30 days |
| `worktree_switch_count` | Count | Switches within one repository |
| `mode_minutes.preview` | Whole minutes | Qualifying Preview activity |
| `mode_minutes.source` | Whole minutes | Qualifying Source activity |
| `mode_minutes.live` | Whole minutes | Qualifying Live activity |
| `feature_counts` | Count | Allowlisted feature/dimension cumulative counts |

`summary_id` equals the prefix, at the configured summary-ID length, of the hexadecimal
`SHA256(install_id + ":" + summary_date)`; current clients use 32 characters. `occurred_at`, envelope
`local_date`, and `timezone_offset_minutes` describe queue time. A backfilled envelope date may be later
than `summary_date`; the two are not interchangeable.

Explicit `summary_date` cannot be later than envelope `local_date`. Current clients always include it.
For legacy schema v1, recovery is permitted only when the original `summary_id` uniquely matches the
formula for a candidate date from envelope `local_date` back through the inclusive date 12 calendar
months earlier. Do not search the next day or approximate the calendar window with 367 days. Exclude
unrecoverable records.

Allowed feature counters:

| `feature_id` | Increment boundary | Dimensions |
| --- | --- | --- |
| `navigation.file_search` | Query changes from empty to nonempty; clearing starts a new session | none |
| `navigation.document_search` | First nonempty query in one search-panel session | none |
| `navigation.frontmatter_filter` | One filter is successfully applied or removed | `action`, `filter_count_bucket` |
| `navigation.worktree_switch` | One non-current worktree request reaches a terminal result | `result` |
| `navigation.deep_link` | One repository-bearing deep link reaches an open terminal result | `type`, `result`, `failure_reason` |
| `editing.activity` | Source/Live writes successfully; at most once per five minutes per renderer session | `mode` |
| `editing.slash_command` | A command passes guards and enters insertion | `command_category` |
| `editing.frontmatter` | One add/edit/delete request reaches a terminal result | `action`, `result` |
| `editing.image_paste` | One pasted-image save reaches a terminal result | `result` |
| `editing.markdown_to_mdx` | One Markdown-to-MDX request reaches a terminal result | `result` |
| `output.pdf_export` | One PDF export reaches a terminal result | `result` |
| `git.sync` | One Git sync reaches a terminal result | `strategy`, `result`, `file_count_bucket`, `error_code`, `drift_kind`, `retry_bucket`, `duration_bucket` |
| `github.open` | One Open on GitHub request reaches a terminal result | `result` |
| `line_reference.copy` | A source location is copied successfully | `line_count_bucket` |

`navigation.deep_link.failure_reason` is allowed only with `result=error`:

```text
repository_not_known
worktree_not_found
repository_selection_invalid
repository_identity_mismatch
repository_open_failed
main_worktree_check_failed
main_worktree_unavailable
primary_not_main
fetch_failed
revision_missing
main_ahead
main_diverged
sync_failed
safe_update_failed
document_open_failed
unknown
```

Legacy errors without it are `legacy_unknown`. `success` or `cancel` carrying the dimension is an
invalid contract. The enum never includes repository identity, paths, filenames, Git output, or selected
content.

For `git.sync`:

- `strategy` is currently `guarded_live_v1`;
- `drift_kind` is `none`, `content_changed`, `head_changed`, or `post_commit_changed`;
- `retry_bucket` is `0`, `1`, or `2_plus`;
- `duration_bucket` is `under_1s`, `1_3s`, `3_10s`, or `over_10s`;
- `workspace_changed` and `head_changed` are allowed error codes.

These are aggregate local counters, not transaction, repository, or actor identifiers. Drift does not
prove AI-agent use; duration includes local Git and network time and is not device-performance evidence.

Reviewing an immutable object-level publisher requires at least 30 complete days, 200 terminal syncs
with `strategy=guarded_live_v1`, and 10 active installations. After that sample, any of these triggers a
design review, not an automatic strategy change:

- combined drift reaches 3%;
- workspace/head guard failures reach 1%;
- at least three reproducible mixed/missing concurrent-change cases are reported.

Below the sample threshold report insufficient evidence, never “0% risk.”

## Relationships and consistency

This contract does not define a user behavior funnel. Relationships validate semantics and expose
missing, duplicate, legacy, or window-truncated records.

### Downloads and first observation

```text
download-page artifact requests ──┐
                                  ├── no shared key; no ordered relationship
first-observed installations ─────┘
```

They may be shown side by side by date, platform, and version, but never divided into a conversion rate.

### Daily-summary balance

Each final daily summary must satisfy:

```text
launch_count = sum(launch_counts_by_entry_kind)
active_minutes = preview_minutes + source_minutes + live_minutes
distinct_repository_count <= repository_open_count
distinct_repository_count <= rolling_30d_distinct_repository_count
engaged installations <= DAU
DAU <= WAU <= MAU for the same target date and coverage
```

Invalid summaries are excluded from all daily-derived metrics and counted by date. Other valid summaries
still produce a `partial_quality` result. A date with no valid summary is unavailable, not zero.
Highest-revision conflicts and identity conflicts propagate the same way. A date with only invalid or
conflicting summaries is `unavailable_quality`; affected dates are listed as `quality_affected_dates`.
Lifecycle-event dates cannot fill daily-summary coverage.

### Update-check balance

```text
check_started
├── current_exact : current and to_version = from_version
├── feed_behind   : current and to_version < from_version
├── available     : to_version > from_version
└── failed_check  : failed and stage = check
```

Only strict App `>=1.10.0` records participate. Do not put legacy data, `current_other`, or failures at
another stage into the denominator to hide a balance difference. Without `attempt_id`, aggregate balance
does not join one result to one start.

### Update-state ordering

```text
available → downloaded → install_started → completed (version change observed)
```

The key is `(install_id, to_version)`. Use the earliest timestamp for a repeated state and require strict
`<`; equal timestamps are not prior. Only strict App `>=1.10.0` groups participate. The seven standard
absolute counts are:

- `available_paths`;
- `downloaded_with_prior_available`;
- `downloaded_without_prior_available`;
- `install_started_with_prior_downloaded`;
- `install_started_without_prior_downloaded`;
- `completed_with_prior_lifecycle`;
- `completed_without_prior_lifecycle`.

All seven use deduplicated state groups, including `completed`. These facts identify explainable
predecessors and window truncation, not conversion. Any ad-hoc ratio includes absolute numerator,
denominator, and window; a denominator below ten is marked small sample.

### Relationships that are not computable

| Question | Missing evidence | Result |
| --- | --- | --- |
| Download request → successful install | No shared key | Not computable |
| Available update → user click | No `update_requested` | Not computable |
| User click → download start | No strict intent source or `download_started` | Not computable |
| Download start → download success | No update transaction ID | Not computable |
| In-app install start → in-app install complete | `completed` has no strict install marker | Not computable |
| D1/D3/D7/D14 true upgrade completion | Install method is unknown and the window is right-censored | Not computable |

## Metric dictionary

### Distribution and installation

- Download-page requests: deduplicated `download_id`, sliced by UTC date, platform, version, artifact.
- Artifact file-size total: sum of `bytes`; name it file size, never traffic.
- Observed installations: distinct `install_id` using its earliest valid `first_observed`.
- First-observed installations: distinct `install_id` with `reason=first_observed`.

### Activity

- **DAU**: distinct installation with a final valid daily summary where `launch_count > 0`,
  `active_minutes > 0`, or any valid feature count is positive.
- **Engaged installations**: distinct installation with active minutes or a feature count; kept separate
  from launch-based DAU.
- **WAU**: union of DAU installations over seven valid daily-summary business dates.
- **MAU**: union over 30 valid dates; insufficient coverage is explicitly partial.
- Active minutes, launches, mode minutes, repository distributions, feature counts, and feature-using
  installations use only final valid daily snapshots.
- Feature adoption divides feature-using installations by active installations in the identical date,
  platform, and version slice.

The activity contract version is `launch_based_v2`. It is not directly comparable with an older formula.
Yesterday is `provisional_late_arrivals`, today is `incomplete_today`, and earlier dates are
`historical`. Missing daily coverage emits explicit nulls with `unavailable_coverage`, never omitted
dates or zeros.

### Updates and reliability

- State event count may include retries.
- State installation count deduplicates `install_id`.
- Strict state groups deduplicate `(install_id,to_version)` for App `>=1.10.0`.
- Check-balance difference uses the strict formula above.
- Failure events/installations slice by stage, error code, version, and platform; missing legacy
  capability remains separate.
- Ordering uses the seven absolute counts above.

### Data quality and source states

Standard output includes file counts, actual coverage dates, latest receive lag, invalid lines,
duplicate IDs, conflicting IDs and quarantined record counts, superseded revisions, recovered/failed
summary dates, check balance, legacy failures missing stage, feed-behind current events, completed paths
without predecessors, and possible window truncation.

| Source state | Meaning | Metric display |
| --- | --- | --- |
| `not_configured` | Caller supplied no source | `N/A` |
| `missing` | Configured path does not exist | `N/A` plus error |
| `empty` | Path exists but has no JSONL/JSONL.GZ | “No log files have formed” |
| `read_error` | Stat, listing, reading, or decompression failed | `N/A`; never partial values |
| `present` | Log files exist | Zero only after filtering finds no valid records |

When a source is not `present`, derived JSON metrics are `null` with `unavailable_source`. WAU is
unavailable if any required valid business date is absent. MAU with fewer than 30 valid dates is partial
and reports required start, actual start, and missing dates. A present date proves only that some usable
records exist, not that every installation uploaded.

## Standard daily report

Order:

1. receiver, event source, download source, coverage, latest receive time, and lag;
2. 30 complete dates, yesterday, and separately incomplete today;
3. download requests and first observations, explicitly not divisible;
4. strict update-check absolute states and balance, with legacy states separate;
5. strict state ordering and window-truncation note;
6. failures by stage, code, platform, and app version;
7. `launch_based_v2` DAU/WAU/MAU, engaged installations, late-arrival status, minutes, modes, features,
   and deep-link failure reasons;
8. data quality and interpretation boundaries;
9. absolute change from a comparable prior report, or “no comparable baseline.”

An existing empty directory means no log file has formed. Only a present source with no valid record in
scope means zero. Every ratio includes numerator and denominator.

## Prohibited inferences

Do not claim:

- “N users downloaded” or “N new users”;
- first observation equals a same-day new installation;
- download-to-install conversion;
- zero Windows update conversion proves Windows update failure;
- every `completed` came from the in-app updater;
- `trigger=automatic` means the user did not click;
- missing `install_started` proves no install happened;
- a legacy failure without stage occurred during download;
- incomplete-today decline is a real usage decline;
- event count equals installation count or unique update opportunities;
- DAU equals natural persons;
- launch-based DAU with zero active minutes is contradictory.

## Contract change gate

Every analytics change:

1. defines the question, fact semantics, unit, join key, relationships, and prohibited inferences here;
2. updates the client allowlist and persistence in `src/telemetry.mjs`;
3. updates receiver validation or distribution logging in `scripts/gitleaf-update-server.py`;
4. updates formulas and standard Markdown in `scripts/summarize-telemetry.mjs`;
5. tests normal, duplicate, missing, out-of-order, cross-version, and truncated-window inputs;
6. updates [architecture](architecture.md) or [release process](release.md) if their boundary changes;
7. marks the new capability by app version after publication.

Increment event `schema_version` only for envelope or incompatible field changes. Optional rollout still
needs an explicit contract capability. `daily_summary_explicit_date` is a schema-v1 capability detected
by field presence, not app version; legacy recovery uses only the deterministic summary-ID formula.

## Implementation map

| Responsibility | Location |
| --- | --- |
| Client identity, daily summaries, event/property validation | `src/telemetry.mjs` |
| Update state generation | `desktop/updates.mjs`, `desktop/main.mjs` |
| Active minutes | `src/telemetry-activity.mjs` |
| Renderer counters | `public/telemetry.js`, `public/app.js`, `src/client/source-editor.mjs` |
| Receiver validation and download logging | `scripts/gitleaf-update-server.py` |
| Aggregation and Markdown reporting | `scripts/summarize-telemetry.mjs` |
| Privacy, transport, storage, retention, and metric contract | This document |
| Application and publication boundaries | `docs/architecture.md`, `docs/release.md` |
