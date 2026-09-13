import assert from "node:assert/strict";
import { test } from "node:test";

import { basecampLinkOrigin } from "./siteUrl.ts";

test("the configured client domain wins over a Vercel request hostname", () => {
  assert.equal(
    basecampLinkOrigin(
      "https://client-project.vercel.app/api/admin/people",
      "https://basecamp.client.example/",
    ),
    "https://basecamp.client.example",
  );
});

test("an unconfigured local or preview deployment uses the request origin", () => {
  assert.equal(
    basecampLinkOrigin("http://localhost:3000/api/admin/people", ""),
    "http://localhost:3000",
  );
  assert.equal(
    basecampLinkOrigin("https://preview-42.vercel.app/api/admin/people", undefined),
    "https://preview-42.vercel.app",
  );
});

test("the configured value is an origin, not a redirect-shaped URL", () => {
  assert.throws(
    () => basecampLinkOrigin("https://request.example", "ftp://basecamp.example.org"),
    /http or https/,
  );
  assert.throws(
    () => basecampLinkOrigin("https://request.example", "https://basecamp.example.org/login"),
    /must not include a path/,
  );
  assert.throws(
    () => basecampLinkOrigin("https://request.example", "https://basecamp.example.org/?next=x"),
    /plain public origin/,
  );
});
