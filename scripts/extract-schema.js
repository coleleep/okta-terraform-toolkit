#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/extract-schema.js <version>');
  console.error('Example: node scripts/extract-schema.js 6.13.0');
  process.exit(1);
}

const outPath = join(__dirname, '..', 'src', 'shared', 'provider-schemas', `${version}.json`);

const tmpDir = mkdtempSync(join(tmpdir(), 'otto-schema-'));
console.log(`Working in temp dir: ${tmpDir}`);

try {
  writeFileSync(join(tmpDir, 'main.tf'), [
    'terraform {',
    '  required_providers {',
    '    okta = {',
    '      source  = "okta/okta"',
    `      version = "= ${version}"`,
    '    }',
    '  }',
    '}',
  ].join('\n'));

  console.log(`Initializing Okta provider v${version}...`);
  execSync('terraform init -no-color -backend=false', {
    cwd: tmpDir,
    stdio: 'inherit',
  });

  console.log('Extracting schema...');
  const raw = execSync('terraform providers schema -json', { cwd: tmpDir }).toString();
  const full = JSON.parse(raw);

  const okta = full.provider_schemas?.['registry.terraform.io/okta/okta'];
  if (!okta) throw new Error('Okta provider block not found in schema output');

  const slimmed = {
    resource_schemas: slimResourceMap(okta.resource_schemas ?? {}),
    data_source_schemas: slimResourceMap(okta.data_source_schemas ?? {}),
  };

  writeFileSync(outPath, JSON.stringify(slimmed, null, 2));
  const resourceCount = Object.keys(slimmed.resource_schemas).length;
  const dataCount = Object.keys(slimmed.data_source_schemas).length;
  console.log(`✓ Written to ${outPath} (${resourceCount} resources, ${dataCount} data sources)`);

} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

function slimResourceMap(resources) {
  const result = {};
  for (const [name, resource] of Object.entries(resources)) {
    result[name] = slimBlock(resource.block ?? {});
  }
  return result;
}

function slimBlock(block) {
  const result = {};

  if (block.attributes && Object.keys(block.attributes).length > 0) {
    result.attributes = {};
    for (const [name, attr] of Object.entries(block.attributes)) {
      const slim = { type: attr.type };
      if (attr.description) slim.description = attr.description;
      if (attr.required) slim.required = true;
      if (attr.optional) slim.optional = true;
      if (attr.computed && !attr.optional && !attr.required) slim.computed = true;
      if (attr.deprecated) slim.deprecated = true;
      result.attributes[name] = slim;
    }
  }

  if (block.block_types && Object.keys(block.block_types).length > 0) {
    result.block_types = {};
    for (const [name, bt] of Object.entries(block.block_types)) {
      const slim = { nesting_mode: bt.nesting_mode };
      if (bt.min_items) slim.min_items = bt.min_items;
      if (bt.max_items) slim.max_items = bt.max_items;
      Object.assign(slim, slimBlock(bt.block ?? {}));
      result.block_types[name] = slim;
    }
  }

  return result;
}
