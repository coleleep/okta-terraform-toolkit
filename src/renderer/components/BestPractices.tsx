import React, { useState, useRef, useCallback } from 'react';

const SECTIONS = [
  { id: 'rate-limits', title: 'Rate Limit Configuration' },
  { id: 'authentication', title: 'Authentication Strategy' },
  { id: 'state', title: 'State Management' },
  { id: 'imports', title: 'Import Strategy' },
  { id: 'dependencies', title: 'Resource Dependencies' },
  { id: 'parallelism', title: 'Parallelism Tuning' },
  { id: 'errors', title: 'Common Errors & Fixes' },
  { id: 'upgrades', title: 'Provider Upgrades' },
  { id: 'gotchas', title: 'Resource-Specific Gotchas' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

// --- Callout helpers ---
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-blue-50 border-l-4 border-okta-blue rounded-r p-3 my-3">
      <p className="text-xs font-medium text-blue-800 mb-0.5">Pro Tip</p>
      <div className="text-xs text-blue-700">{children}</div>
    </div>
  );
}
function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-red-50 border-l-4 border-red-500 rounded-r p-3 my-3">
      <p className="text-xs font-medium text-red-800 mb-0.5">Critical</p>
      <div className="text-xs text-red-700">{children}</div>
    </div>
  );
}
function Recommended({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-green-50 border-l-4 border-green-500 rounded-r p-3 my-3">
      <p className="text-xs font-medium text-green-800 mb-0.5">Recommended</p>
      <div className="text-xs text-green-700">{children}</div>
    </div>
  );
}
function Caution({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-50 border-l-4 border-amber-500 rounded-r p-3 my-3">
      <p className="text-xs font-medium text-amber-800 mb-0.5">Caution</p>
      <div className="text-xs text-amber-700">{children}</div>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="bg-okta-dark text-white/90 rounded-lg p-3 text-xs font-mono overflow-x-auto my-3 leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-gray-700 mt-4 mb-2">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-gray-600 leading-relaxed mb-2">{children}</p>;
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="text-xs text-gray-600 space-y-1 mb-3 ml-4 list-disc">{children}</ul>;
}

// --- Section content ---

function RateLimitsContent() {
  return (
    <>
      <P>
        Okta enforces per-endpoint rate limits. The Terraform provider makes many API calls per resource,
        so misconfigured rate limit settings are the #1 cause of failed or painfully slow runs.
      </P>

      <H3>Provider Settings Reference</H3>
      <div className="overflow-x-auto my-3">
        <table className="w-full text-xs border border-gray-200 rounded">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2 font-medium text-gray-600">Setting</th>
              <th className="text-left p-2 font-medium text-gray-600">Default</th>
              <th className="text-left p-2 font-medium text-gray-600">What It Does</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr><td className="p-2 font-mono">max_retries</td><td className="p-2">5</td><td className="p-2">Times to retry after a 429. More retries = more resilient but burns quota on stuck requests.</td></tr>
            <tr><td className="p-2 font-mono">backoff</td><td className="p-2">true</td><td className="p-2">Exponential backoff between retries. Always keep enabled.</td></tr>
            <tr><td className="p-2 font-mono">min_wait_seconds</td><td className="p-2">30</td><td className="p-2">Minimum wait before first retry. Too low = wasted requests before window resets.</td></tr>
            <tr><td className="p-2 font-mono">max_wait_seconds</td><td className="p-2">300</td><td className="p-2">Maximum wait between retries. Too high = Terraform hangs for minutes on a single resource.</td></tr>
            <tr><td className="p-2 font-mono">request_timeout</td><td className="p-2">0 (none)</td><td className="p-2">Per-request timeout. Default is unlimited — a stuck request blocks the entire run.</td></tr>
            <tr><td className="p-2 font-mono">max_api_capacity</td><td className="p-2">100</td><td className="p-2">% of rate limit to consume. 100 = use all capacity. Lower = leave room for other consumers.</td></tr>
          </tbody>
        </table>
      </div>

      <H3>How Backoff Works</H3>
      <P>
        When the provider gets a <strong>429 Too Many Requests</strong> response, it doesn't retry immediately.
        With <code className="bg-gray-100 px-1 rounded">backoff = true</code>, it uses <strong>exponential backoff with jitter</strong>:
      </P>
      <UL>
        <li><strong>Retry 1:</strong> Wait <code className="bg-gray-100 px-1 rounded">min_wait_seconds</code> (default 30s)</li>
        <li><strong>Retry 2:</strong> Wait 2× the previous wait (60s)</li>
        <li><strong>Retry 3:</strong> Wait 2× again (120s)</li>
        <li><strong>Retry N:</strong> Doubles each time, capped at <code className="bg-gray-100 px-1 rounded">max_wait_seconds</code> (default 300s)</li>
      </UL>
      <P>
        The provider also reads the <code className="bg-gray-100 px-1 rounded">X-Rate-Limit-Reset</code> header from Okta's 429 response.
        If the reset time is sooner than the calculated backoff, it waits for the reset instead. This means the actual wait is:
        <strong> max(backoff_delay, time_until_rate_limit_reset)</strong>.
      </P>

      <H3>Runtime Impact</H3>
      <P>
        Backoff is the biggest hidden contributor to Terraform run time. Here's how the settings interact:
      </P>
      <div className="overflow-x-auto my-3">
        <table className="w-full text-xs border border-gray-200 rounded">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2 font-medium text-gray-600">Scenario</th>
              <th className="text-left p-2 font-medium text-gray-600">Time Added Per 429</th>
              <th className="text-left p-2 font-medium text-gray-600">With 5 Retries</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr><td className="p-2">min_wait=30, max_wait=300</td><td className="p-2">30s → 60s → 120s → 240s → 300s</td><td className="p-2"><strong>12.5 min</strong> worst case</td></tr>
            <tr><td className="p-2">min_wait=10, max_wait=120</td><td className="p-2">10s → 20s → 40s → 80s → 120s</td><td className="p-2"><strong>4.5 min</strong> worst case</td></tr>
            <tr><td className="p-2">min_wait=5, max_wait=60</td><td className="p-2">5s → 10s → 20s → 40s → 60s</td><td className="p-2"><strong>2.25 min</strong> worst case</td></tr>
          </tbody>
        </table>
      </div>
      <P>
        Now multiply by the number of resources hitting 429s. With default settings and 50 resources each hitting one 429,
        that's <strong>50 × 30s = 25 minutes</strong> of pure waiting on the first retry alone.
      </P>

      <Warning>
        With <code>backoff = false</code>, retries happen immediately — this sounds faster but floods the API with requests
        that will all get 429'd again, burning through <code>max_retries</code> instantly and failing. <strong>Never disable backoff.</strong>
      </Warning>

      <Tip>
        The single most impactful optimization: <strong>reduce parallelism so you never hit 429s in the first place.</strong>{' '}
        A run that never triggers backoff is dramatically faster than one with aggressive parallelism that constantly retries.
        Use <code className="bg-blue-100/50 px-1 rounded">-parallelism=1</code> and increase only after verifying no 429s in the logs.
      </Tip>

      <H3>max_api_capacity — The Throttle</H3>
      <P>
        Before each request, the provider checks the <code className="bg-gray-100 px-1 rounded">X-Rate-Limit-Remaining</code> header from the previous response.
        If remaining capacity drops below <code className="bg-gray-100 px-1 rounded">(100 - max_api_capacity)%</code> of the limit, the provider
        <strong> preemptively sleeps</strong> until the window resets — even though it hasn't been 429'd yet.
      </P>
      <UL>
        <li><strong>max_api_capacity = 100</strong> (default): No preemptive throttling. The provider sends requests until it gets a 429.</li>
        <li><strong>max_api_capacity = 80</strong>: Stops sending when 80% of the rate limit is consumed, waits for reset. Prevents 429s but adds ~20% idle time.</li>
        <li><strong>max_api_capacity = 50</strong>: Very conservative. Uses only half the available capacity. Good for shared orgs but significantly slows runs.</li>
      </UL>
      <P>
        The tradeoff: lower capacity = fewer 429s and smoother runs, but more preemptive waiting. Higher capacity = faster when rate limits are generous, but painful backoff spikes when they're not.
      </P>

      <H3>When to Adjust</H3>
      <UL>
        <li><strong>Reduce max_retries to 2-3</strong> if your rate limits are low (&lt;100/window). Each retry burns quota and adds exponential wait time.</li>
        <li><strong>Set max_api_capacity to 60-80%</strong> if other integrations or the Okta admin console share the org. 100% starves everything else.</li>
        <li><strong>Set request_timeout to 30s.</strong> The default (unlimited) means one stuck API call blocks your entire Terraform run indefinitely.</li>
        <li><strong>Tune min_wait_seconds</strong> based on your reset window. If your windows are 60s, waiting 30s before the first retry is reasonable. If they're 10s, drop to 5-10s.</li>
        <li><strong>Lower min_wait_seconds + max_wait_seconds together</strong> to reduce backoff penalties. The defaults (30/300) create worst-case 12.5 min waits per resource.</li>
      </UL>

      <H3>Example Configs by Scale</H3>
      <Code>{`# Small org (<1,000 resources)
provider "okta" {
  max_retries      = 3
  backoff          = true
  min_wait_seconds = 10
  max_wait_seconds = 120
  request_timeout  = 30
  max_api_capacity = 80
}

# Medium org (1,000-10,000 resources)
provider "okta" {
  max_retries      = 4
  backoff          = true
  min_wait_seconds = 15
  max_wait_seconds = 180
  request_timeout  = 30
  max_api_capacity = 70
}

# Large org (10,000+ resources)
provider "okta" {
  max_retries      = 5
  backoff          = true
  min_wait_seconds = 20
  max_wait_seconds = 300
  request_timeout  = 30
  max_api_capacity = 50
}`}</Code>

      <Tip>
        Use the Rate Limits tab in this tool to see your actual per-endpoint limits. The Config tab generates
        optimized settings based on your real data — don't guess when you can measure.
      </Tip>
    </>
  );
}

function AuthenticationContent() {
  return (
    <>
      <P>
        The Okta Terraform provider supports two authentication methods. Each has tradeoffs that affect security, scope, and operational complexity.
      </P>

      <H3>API Token vs OAuth — Quick Comparison</H3>
      <div className="overflow-x-auto my-3">
        <table className="w-full text-xs border border-gray-200 rounded">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2 font-medium text-gray-600">Factor</th>
              <th className="text-left p-2 font-medium text-gray-600">API Token (SSWS)</th>
              <th className="text-left p-2 font-medium text-gray-600">OAuth (Service App)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr><td className="p-2 font-medium">Setup complexity</td><td className="p-2">Simple — generate in admin console</td><td className="p-2">Moderate — create service app, grant scopes, generate keys</td></tr>
            <tr><td className="p-2 font-medium">Permissions</td><td className="p-2">Inherits admin's full role</td><td className="p-2">Scoped to granted OAuth scopes only</td></tr>
            <tr><td className="p-2 font-medium">Endpoint coverage</td><td className="p-2">All endpoints</td><td className="p-2">Most — some endpoints have no OAuth scope (schemas, templates, threat insight)</td></tr>
            <tr><td className="p-2 font-medium">Rotation</td><td className="p-2">Manual — create new, update config, revoke old</td><td className="p-2">Automatic via key rotation on the service app</td></tr>
            <tr><td className="p-2 font-medium">Audit trail</td><td className="p-2">Tied to admin user</td><td className="p-2">Tied to service app — cleaner separation</td></tr>
            <tr><td className="p-2 font-medium">Expiration</td><td className="p-2">Expires if admin is inactive 30+ days</td><td className="p-2">No inactivity expiration</td></tr>
          </tbody>
        </table>
      </div>

      <H3>When to Use Each</H3>
      <UL>
        <li><strong>API Token</strong> — Best for getting started, small teams, orgs needing schema/template management. Simpler but broader access.</li>
        <li><strong>OAuth</strong> — Best for production pipelines, compliance requirements, least-privilege access. Use when you don't need schema management via Terraform.</li>
        <li><strong>Hybrid</strong> — Use OAuth for the main Terraform workspace, and a separate API-token workspace for schema-only resources.</li>
      </UL>

      <Warning>
        API tokens inherit the full permissions of the admin who created them. If that admin is deactivated or their role changes, the token stops working. Create tokens with a dedicated service account, not a personal admin account.
      </Warning>

      <H3>API Token Rotation</H3>
      <UL>
        <li>Rotate tokens every 90 days at minimum.</li>
        <li>Create the new token before revoking the old one to avoid downtime.</li>
        <li>Store tokens in a secrets manager (Vault, AWS Secrets Manager, etc.) — never in version control.</li>
        <li>Use <code className="bg-gray-100 px-1 rounded">TF_VAR_okta_api_token</code> environment variable instead of hardcoding in .tfvars.</li>
      </UL>

      <H3>Custom Admin Role Limitations</H3>
      <Caution>
        Custom admin roles have important restrictions when managing groups:
        <ul className="list-disc ml-4 mt-1 space-y-1">
          <li>Custom admins <strong>cannot manage groups that are assigned to an admin role</strong>. If a group grants admin privileges, only a Super Admin or a standard Group Admin with explicit assignment can modify it.</li>
          <li>Custom admins <strong>cannot modify group membership for groups containing users with admin roles</strong>. This is Okta's privilege escalation prevention.</li>
          <li>If your Terraform config manages groups that are also used for admin role assignments, you need a Super Admin or standard admin token — custom roles won't work.</li>
        </ul>
      </Caution>
    </>
  );
}

function StateManagementContent() {
  return (
    <>
      <P>
        Terraform state tracks the mapping between your config and real Okta resources. Losing or corrupting state means Terraform can't manage existing resources — it will try to recreate everything.
      </P>

      <Recommended>
        Use a remote backend with state locking for any shared or production Terraform configuration. Local state files are only acceptable for personal experimentation.
      </Recommended>

      <H3>Backend Options</H3>
      <div className="overflow-x-auto my-3">
        <table className="w-full text-xs border border-gray-200 rounded">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2 font-medium text-gray-600">Backend</th>
              <th className="text-left p-2 font-medium text-gray-600">Locking</th>
              <th className="text-left p-2 font-medium text-gray-600">Best For</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr><td className="p-2 font-mono">s3 + DynamoDB</td><td className="p-2">Yes (DynamoDB)</td><td className="p-2">AWS shops. Reliable, low cost, well-documented.</td></tr>
            <tr><td className="p-2 font-mono">azurerm</td><td className="p-2">Yes (blob lease)</td><td className="p-2">Azure shops. Native blob storage locking.</td></tr>
            <tr><td className="p-2 font-mono">gcs</td><td className="p-2">Yes (native)</td><td className="p-2">GCP shops. Built-in locking.</td></tr>
            <tr><td className="p-2 font-mono">remote (TFC/TFE)</td><td className="p-2">Yes (built-in)</td><td className="p-2">Teams using Terraform Cloud/Enterprise. Managed state + runs.</td></tr>
          </tbody>
        </table>
      </div>

      <H3>Example: S3 Backend</H3>
      <Code>{`terraform {
  backend "s3" {
    bucket         = "my-okta-terraform-state"
    key            = "prod/okta.tfstate"
    region         = "us-east-1"
    dynamodb_table = "terraform-locks"
    encrypt        = true
  }
}`}</Code>

      <H3>What to .gitignore</H3>
      <Code>{`# Never commit these
*.tfstate
*.tfstate.backup
*.tfvars       # may contain API tokens
.terraform/    # provider binaries`}</Code>

      <Warning>
        Without state locking, two concurrent <code>terraform apply</code> runs can corrupt your state file. This is unrecoverable without backups. Always use a backend that supports locking.
      </Warning>
    </>
  );
}

function ImportStrategyContent() {
  return (
    <>
      <P>
        Importing existing Okta resources into Terraform requires careful planning. A bad import can overwrite live configuration or leave Terraform in an inconsistent state.
      </P>

      <H3>Import Blocks vs terraform import</H3>
      <div className="overflow-x-auto my-3">
        <table className="w-full text-xs border border-gray-200 rounded">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-2 font-medium text-gray-600">Approach</th>
              <th className="text-left p-2 font-medium text-gray-600">When to Use</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr>
              <td className="p-2 font-mono">import {"{"} ... {"}"}</td>
              <td className="p-2">Terraform 1.5+. Declarative, version-controlled, repeatable. Preferred for bulk imports.</td>
            </tr>
            <tr>
              <td className="p-2 font-mono">terraform import</td>
              <td className="p-2">One-off imports, older Terraform versions, debugging. Imperative, not in code.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <H3>Import Block Example</H3>
      <Code>{`import {
  to = okta_group.engineering
  id = "00g1234567890abcdef"
}

resource "okta_group" "engineering" {
  name        = "Engineering"
  description = "Engineering team group"
}`}</Code>

      <H3>Bulk Import Workflow</H3>
      <UL>
        <li><strong>1. Write resource blocks</strong> matching existing Okta resources (use the Export tab for scaffolding).</li>
        <li><strong>2. Add import blocks</strong> with the Okta resource IDs.</li>
        <li><strong>3. Run <code className="bg-gray-100 px-1 rounded">terraform plan</code></strong> — review the diff carefully. There should be zero changes if your config matches reality.</li>
        <li><strong>4. Run <code className="bg-gray-100 px-1 rounded">terraform apply</code></strong> — imports the state without modifying Okta.</li>
        <li><strong>5. Remove import blocks</strong> after successful import (they're one-time use).</li>
      </UL>

      <H3>Protect Critical Resources</H3>
      <Code>{`resource "okta_group" "all_employees" {
  name = "All Employees"

  lifecycle {
    prevent_destroy = true
  }
}

resource "okta_app_oauth" "production_app" {
  label     = "Production App"
  type      = "web"

  lifecycle {
    # Don't overwrite fields managed outside Terraform
    ignore_changes = [client_secret]
  }
}`}</Code>

      <Caution>
        After importing, always run <code className="bg-amber-100 px-1 rounded">terraform plan</code> before <code className="bg-amber-100 px-1 rounded">apply</code>. If the plan shows unexpected changes, your resource config doesn't match the live state — fix the config first.
      </Caution>
    </>
  );
}

function DependenciesContent() {
  return (
    <>
      <P>
        Okta resources have natural dependency chains. Terraform resolves most automatically through resource references,
        but some require explicit ordering.
      </P>

      <H3>Common Okta Dependency Chains</H3>
      <Code>{`# Auth Server → Scopes → Claims → Policies → Rules
okta_auth_server
  └→ okta_auth_server_scope
  └→ okta_auth_server_claim
  └→ okta_auth_server_policy
       └→ okta_auth_server_policy_rule

# App → Assignments → Sign-on Policy
okta_app_oauth
  └→ okta_app_group_assignment
  └→ okta_app_user
  └→ okta_app_signon_policy_rule

# User Type → Schema → Users
okta_user_type
  └→ okta_user_schema_property
       └→ okta_user`}</Code>

      <H3>Implicit vs Explicit Dependencies</H3>
      <UL>
        <li><strong>Implicit (preferred)</strong> — Terraform detects dependencies when you reference one resource's output in another. Example: <code className="bg-gray-100 px-1 rounded">auth_server_id = okta_auth_server.main.id</code></li>
        <li><strong>Explicit (depends_on)</strong> — Use only when there's no natural attribute reference but order still matters. Example: sign-on policies that must exist before app creation.</li>
      </UL>

      <Tip>
        If you see "resource not found" errors during apply, the dependency chain may be wrong. Check that dependent resources
        reference their parent's attributes (not hardcoded IDs) so Terraform knows the creation order.
      </Tip>

      <H3>Avoiding Circular Dependencies</H3>
      <UL>
        <li>Never have Resource A reference Resource B while B also references A.</li>
        <li>If you hit this, extract the shared dependency into its own resource or use a data source for the lookup.</li>
        <li>Common trap: a group that references a user who references the group. Break the cycle by managing the assignment separately with <code className="bg-gray-100 px-1 rounded">okta_group_memberships</code>.</li>
      </UL>
    </>
  );
}

function ParallelismContent() {
  return (
    <>
      <P>
        Terraform's default parallelism is 10 — meaning it makes 10 concurrent API calls. For most Okta orgs this is far too aggressive and will trigger 429 rate limit errors within seconds.
      </P>

      <Warning>
        Running <code>terraform apply</code> with default parallelism against an Okta org with standard rate limits will almost certainly hit 429 errors,
        causing retries, backoff delays, and significantly longer run times.
      </Warning>

      <H3>How to Set Parallelism</H3>
      <Code>{`# CLI flag (per-run)
terraform apply -parallelism=2

# Or set via environment variable
export TF_CLI_ARGS_apply="-parallelism=2"
export TF_CLI_ARGS_plan="-parallelism=2"`}</Code>

      <H3>Choosing the Right Value</H3>
      <P>
        The formula: <strong>parallelism = (lowest_rate_limit × max_api_capacity / 100) ÷ requests_per_resource</strong>
      </P>
      <UL>
        <li><strong>Standard Okta orgs (50-100 req/window)</strong>: Use parallelism 1-2</li>
        <li><strong>One App / One API orgs (200-600 req/window)</strong>: Use parallelism 2-4</li>
        <li><strong>Enterprise orgs (1000+ req/window)</strong>: Use parallelism 4-8</li>
      </UL>

      <Recommended>
        Start with parallelism=1 and increase gradually. A slower but successful run beats a fast run that fails halfway through and leaves your state inconsistent.
      </Recommended>

      <H3>Debugging Rate Limit Issues</H3>
      <Code>{`# Enable debug logging to see request timing
export TF_LOG=DEBUG
terraform apply -parallelism=2 2>&1 | tee terraform.log

# Search for rate limit responses
grep "429" terraform.log
grep "X-Rate-Limit" terraform.log`}</Code>

      <Tip>
        The Config tab in this tool calculates optimal parallelism based on your actual rate limits and workload. Use it instead of guessing.
      </Tip>
    </>
  );
}

function ErrorsContent() {
  return (
    <>
      <P>
        Common Terraform + Okta errors and how to fix them.
      </P>

      <H3>429 Too Many Requests</H3>
      <P><strong>Cause:</strong> Rate limit exhausted — too many API calls in the current window.</P>
      <UL>
        <li>Reduce parallelism (<code className="bg-gray-100 px-1 rounded">-parallelism=1</code>)</li>
        <li>Lower <code className="bg-gray-100 px-1 rounded">max_api_capacity</code> to leave headroom (60-80%)</li>
        <li>Increase <code className="bg-gray-100 px-1 rounded">min_wait_seconds</code> so retries wait for the window to reset</li>
        <li>Request a rate limit increase from Okta support if consistently hitting limits</li>
      </UL>

      <H3>403 Forbidden</H3>
      <P><strong>Cause:</strong> Insufficient permissions for the operation.</P>
      <UL>
        <li>Check admin role — many resources require Super Admin</li>
        <li>For OAuth: verify the correct scopes are granted on the service app</li>
        <li>For custom admin roles: check if the resource requires a standard admin role</li>
        <li>Some resources (schemas, templates) have no OAuth scope — use API token</li>
      </UL>

      <H3>409 Conflict</H3>
      <P><strong>Cause:</strong> Resource was modified outside Terraform between plan and apply.</P>
      <UL>
        <li>Run <code className="bg-gray-100 px-1 rounded">terraform refresh</code> to sync state with reality</li>
        <li>Re-run plan to see the current diff</li>
        <li>Check if another admin or automation is modifying the same resources</li>
        <li>Use state locking to prevent concurrent applies</li>
      </UL>

      <H3>404 Not Found (after create)</H3>
      <P><strong>Cause:</strong> Eventual consistency — Terraform reads the resource immediately after creation but the API hasn't propagated yet.</P>
      <UL>
        <li>Often resolves on retry — increase <code className="bg-gray-100 px-1 rounded">max_retries</code></li>
        <li>Reduce parallelism so creates aren't immediately followed by reads</li>
        <li>If persistent, check for dependency ordering issues</li>
      </UL>

      <H3>E0000015 — Feature Not Licensed</H3>
      <P><strong>Cause:</strong> Attempting to manage a feature (e.g., Realms, Device Trust) not enabled on your Okta org.</P>
      <UL>
        <li>Remove the resource from your Terraform config</li>
        <li>Contact Okta support to enable the feature if needed</li>
        <li>Use <code className="bg-gray-100 px-1 rounded">count</code> or <code className="bg-gray-100 px-1 rounded">for_each</code> with a variable to conditionally include licensed-only resources</li>
      </UL>

      <Tip>
        The Rate Limits tab in this tool marks unlicensed endpoints as "skipped" — check there to see which features your org doesn't have.
      </Tip>
    </>
  );
}

function UpgradesContent() {
  return (
    <>
      <P>
        Okta Terraform provider releases frequently. Upgrades can introduce breaking changes, renamed attributes, or new required fields.
      </P>

      <H3>Pre-Upgrade Checklist</H3>
      <UL>
        <li>Pin your current version in <code className="bg-gray-100 px-1 rounded">required_providers</code></li>
        <li>Back up your state file</li>
        <li>Read the <a href="https://github.com/okta/terraform-provider-okta/releases" className="text-okta-blue hover:underline" target="_blank" rel="noopener noreferrer">release notes / changelog</a></li>
        <li>Search for deprecated or removed resources you use</li>
      </UL>

      <Code>{`# Pin version to prevent accidental upgrades
terraform {
  required_providers {
    okta = {
      source  = "okta/okta"
      version = "~> 4.12.0"  # Only allow patch updates
    }
  }
}`}</Code>

      <H3>Upgrade Process</H3>
      <UL>
        <li><strong>1.</strong> Update version constraint in <code className="bg-gray-100 px-1 rounded">required_providers</code></li>
        <li><strong>2.</strong> Run <code className="bg-gray-100 px-1 rounded">terraform init -upgrade</code></li>
        <li><strong>3.</strong> Run <code className="bg-gray-100 px-1 rounded">terraform plan</code> — check for unexpected changes or errors</li>
        <li><strong>4.</strong> Fix any deprecated attributes or config changes</li>
        <li><strong>5.</strong> Test in a non-production org first</li>
        <li><strong>6.</strong> Apply to production</li>
      </UL>

      <H3>Rollback</H3>
      <Code>{`# Revert version pin
okta = {
  source  = "okta/okta"
  version = "= 4.11.0"  # Exact previous version
}

# Re-initialize
terraform init -upgrade

# Verify state is still valid
terraform plan`}</Code>

      <Caution>
        Major version upgrades (e.g., 3.x → 4.x) often include state migrations and resource renames. These are harder to roll back. Test thoroughly in a non-production org before upgrading production.
      </Caution>
    </>
  );
}

function GotchasContent() {
  return (
    <>
      <P>
        Resource-specific issues that catch people off guard.
      </P>

      <H3>User/Group Schemas</H3>
      <UL>
        <li>Schema property endpoints (<code className="bg-gray-100 px-1 rounded">okta_user_schema_property</code>, <code className="bg-gray-100 px-1 rounded">okta_group_schema_property</code>) have <strong>no OAuth scope</strong>. You must use an API token.</li>
        <li>If using OAuth for everything else, split schemas into a separate workspace with API token auth.</li>
      </UL>

      <H3>User Types</H3>
      <UL>
        <li>User Types <strong>do have OAuth scopes</strong>: <code className="bg-gray-100 px-1 rounded">okta.userTypes.read</code> and <code className="bg-gray-100 px-1 rounded">okta.userTypes.manage</code>. They can be managed with OAuth.</li>
        <li>Create user types before schema properties that depend on them.</li>
      </UL>

      <H3>Groups + Admin Roles</H3>
      <Warning>
        <ul className="list-disc ml-4 space-y-1">
          <li>Groups assigned to admin roles cannot be managed by custom admin roles. Terraform will get 403 errors.</li>
          <li>Groups containing admin users have restricted membership modification. This is Okta's privilege escalation prevention.</li>
          <li>If Terraform manages groups used for admin role assignments, the service account needs Super Admin or a standard Group Admin role with explicit group assignment — custom roles won't work.</li>
        </ul>
      </Warning>

      <H3>SAML Applications</H3>
      <UL>
        <li>SAML metadata depends on the signing key. Import or create the key first.</li>
        <li>The <code className="bg-gray-100 px-1 rounded">key_id</code> attribute links the app to its signing certificate.</li>
        <li>Metadata endpoint rate limits are separate from the app endpoint — check both.</li>
      </UL>

      <H3>Policy Rules &amp; Priority Ordering</H3>
      <UL>
        <li>Policy rules have a <code className="bg-gray-100 px-1 rounded">priority</code> attribute that controls evaluation order. The Okta API <strong>shifts priorities automatically</strong> when conflicts occur — assigning priority 2 pushes existing priority-2 to 3.</li>
        <li>Concurrent rule modifications cause <strong>409 conflicts and state drift</strong>. This is the #1 cause of flaky Terraform applies with policies.</li>
        <li><strong>Required fix:</strong> Chain all rules under each policy with <code className="bg-gray-100 px-1 rounded">depends_on</code> in ascending priority order. This serializes rule operations while other resources still run in parallel.</li>
        <li>Do <strong>NOT</strong> use <code className="bg-gray-100 px-1 rounded">parallelism=1</code> globally — it&apos;s wasteful. The <code className="bg-gray-100 px-1 rounded">depends_on</code> chain achieves serialization only where needed.</li>
        <li><strong>Priority swaps:</strong> Move rules to temporary high priorities (100+) first, apply, then move to final priorities. Direct swaps cause cascading shifts.</li>
        <li>Manage <strong>all rules</strong> for a given policy in Terraform, or none. Mixed management (some in Terraform, some manual) causes priority drift.</li>
      </UL>
      <div className="bg-gray-50 border border-gray-200 rounded p-3 mt-2 mb-3 text-xs font-mono whitespace-pre">{`resource "okta_auth_server_policy_rule" "rule_1" {
  priority = 1
}

resource "okta_auth_server_policy_rule" "rule_2" {
  depends_on = [okta_auth_server_policy_rule.rule_1]
  priority   = 2
}

resource "okta_auth_server_policy_rule" "rule_3" {
  depends_on = [okta_auth_server_policy_rule.rule_2]
  priority   = 3
}`}</div>

      <H3>SMS Templates</H3>
      <UL>
        <li>No OAuth scope available. API token only.</li>
        <li>Template changes can affect active MFA flows — test in non-prod first.</li>
      </UL>

      <H3>Threat Insight</H3>
      <UL>
        <li>No OAuth scope available. API token only.</li>
        <li>Requires Super Admin role.</li>
      </UL>

      <Tip>
        The Workload tab's Auth Recommendations section dynamically shows which resources need API tokens vs OAuth based on your selection. Use it to plan your auth strategy.
      </Tip>
    </>
  );
}

// --- Main component ---

export default function BestPractices() {
  const [expanded, setExpanded] = useState<Set<SectionId>>(new Set(['rate-limits']));
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const toggle = useCallback((id: SectionId) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = () => setExpanded(new Set(SECTIONS.map(s => s.id)));
  const collapseAll = () => setExpanded(new Set());

  const scrollTo = (id: string) => {
    const el = sectionRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Expand if collapsed
      setExpanded(prev => {
        if (prev.has(id as SectionId)) return prev;
        const next = new Set(prev);
        next.add(id as SectionId);
        return next;
      });
    }
  };

  const CONTENT: Record<SectionId, React.ReactNode> = {
    'rate-limits': <RateLimitsContent />,
    'authentication': <AuthenticationContent />,
    'state': <StateManagementContent />,
    'imports': <ImportStrategyContent />,
    'dependencies': <DependenciesContent />,
    'parallelism': <ParallelismContent />,
    'errors': <ErrorsContent />,
    'upgrades': <UpgradesContent />,
    'gotchas': <GotchasContent />,
  };

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-lg font-bold text-okta-navy">Okta Terraform Provider Best Practices</h1>
        <p className="text-xs text-gray-500 mt-1">
          Opinionated guidance for the Okta Terraform Provider. Based on common support patterns and production experience.
        </p>
      </div>

      {/* Table of contents */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => scrollTo(s.id)}
            className="text-xs px-2.5 py-1 rounded-full border border-gray-200 text-gray-500 hover:border-okta-blue hover:text-okta-blue transition-colors"
          >
            {s.title}
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={expandAll} className="text-xs text-gray-400 hover:text-okta-blue transition-colors">Expand all</button>
        <span className="text-xs text-gray-300">|</span>
        <button onClick={collapseAll} className="text-xs text-gray-400 hover:text-okta-blue transition-colors">Collapse all</button>
      </div>

      {/* Sections */}
      <div className="space-y-2">
        {SECTIONS.map(s => {
          const isExpanded = expanded.has(s.id);
          return (
            <div
              key={s.id}
              ref={el => { sectionRefs.current[s.id] = el; }}
              className={`rounded-lg border transition-all ${isExpanded ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50'}`}
            >
              <button
                onClick={() => toggle(s.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <span className={`text-sm font-semibold ${isExpanded ? 'text-okta-navy' : 'text-gray-600'}`}>
                  {s.title}
                </span>
                <span className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                  &#9662;
                </span>
              </button>
              {isExpanded && (
                <div className="px-4 pb-4 border-t border-gray-100">
                  <div className="pt-3">{CONTENT[s.id]}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
