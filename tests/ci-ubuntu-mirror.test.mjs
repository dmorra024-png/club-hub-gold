import { test } from "node:test";
import assert from "node:assert/strict";
import { officialUbuntuMirror } from "../scripts/prepare-ci-ubuntu-mirrors.mjs";
test("slow regional mirror replacement retains signed suites, priorities and secure fallback", () => {
  const fixtures = [
    [
      "http://us-east-2.ec2.archive.ubuntu.com/ubuntu priority:1\nhttps://archive.ubuntu.com/ubuntu priority:2\n",
      "https://archive.ubuntu.com/ubuntu priority:1\nhttps://archive.ubuntu.com/ubuntu priority:2\n",
    ],
    [
      "Types: deb\nURIs: http://eu-west-1.ec2.archive.ubuntu.com/ubuntu/\nSuites: noble noble-updates\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n",
      "Types: deb\nURIs: https://archive.ubuntu.com/ubuntu/\nSuites: noble noble-updates\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n",
    ],
  ];
  for (const [input, expected] of fixtures) {
    assert.equal(officialUbuntuMirror(input), expected);
    assert.equal(officialUbuntuMirror(expected), expected);
  }
});
test("browser CI leaves nonregional mirrors, signing and unrelated URLs unchanged", () => {
  for (const source of [
    "mirror+file:/etc/apt/apt-mirrors.txt",
    "https://azure.archive.ubuntu.com/ubuntu",
    "https://security.ubuntu.com/ubuntu",
    "http://us-east-2.ec2.archive.ubuntu.com.evil.invalid/ubuntu",
    "http://us-east-2.ec2.archive.ubuntu.com/ubuntu-other",
    "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n",
  ])
    assert.equal(officialUbuntuMirror(source), source);
});


test("stalled Azure HTTP downloads use the official HTTPS archive without altering signed repositories",()=>{
 const source="Types: deb\nURIs: http://azure.archive.ubuntu.com/ubuntu/\nSuites: noble noble-updates\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n";
 const expected=source.replace("http://azure.archive.ubuntu.com/ubuntu/","https://archive.ubuntu.com/ubuntu/");
 assert.equal(officialUbuntuMirror(source),expected);
 assert.equal(officialUbuntuMirror(expected),expected);
 for(const unrelated of ["http://azure.archive.ubuntu.com.evil.invalid/ubuntu","http://azure.archive.ubuntu.com/ubuntu-other","https://azure.archive.ubuntu.com/ubuntu","https://security.ubuntu.com/ubuntu"])
  assert.equal(officialUbuntuMirror(unrelated),unrelated);
});
