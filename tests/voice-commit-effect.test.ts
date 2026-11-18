import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useCommittedEffect } from "../src/hooks/useCommittedEffect.ts";
import { applicationPorts } from "../src/lib/voice/application-ports.ts";
test("server renders never publish another request's route capability", () => {
  function Fixture({ owner }: { owner: string }) {
    useCommittedEffect(
      () =>
        applicationPorts.register(owner, "ssr-probe", { snapshot: () => ({ name: "synthetic" }) }),
      [owner],
    );
    return createElement("span", null, "synthetic");
  }
  for (const owner of ["ssr-commit-tenant-a", "ssr-commit-tenant-b"]) {
    assert.equal(renderToString(createElement(Fixture, { owner })), "<span>synthetic</span>");
    assert.equal(applicationPorts.get(owner, "ssr-probe"), undefined);
  }
});
