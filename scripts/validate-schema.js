#!/usr/bin/env node
'use strict';

const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/validate-schema.js <version>');
  process.exit(1);
}

const schemaPath = join(__dirname, '..', 'src', 'shared', 'provider-schemas', `${version}.json`);

if (!existsSync(schemaPath)) {
  console.error(`Schema file not found: ${schemaPath}`);
  process.exit(1);
}

let schema;
try {
  schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
} catch (e) {
  console.error(`Failed to parse ${schemaPath}: ${e.message}`);
  process.exit(1);
}

const errors = [];

if (!schema.resource_schemas || typeof schema.resource_schemas !== 'object')
  errors.push('Missing or invalid resource_schemas');
if (!schema.data_source_schemas || typeof schema.data_source_schemas !== 'object')
  errors.push('Missing or invalid data_source_schemas');

const appOauth = schema.resource_schemas?.['okta_app_oauth'];
if (!appOauth)
  errors.push('Missing well-known resource okta_app_oauth — extraction likely failed');
if (appOauth && (!appOauth.attributes || typeof appOauth.attributes !== 'object'))
  errors.push('okta_app_oauth.attributes is missing or not an object');

const resourceCount = Object.keys(schema.resource_schemas ?? {}).length;
if (resourceCount < 50)
  errors.push(`Only ${resourceCount} resources found — expected 100+, extraction may be incomplete`);

if (errors.length > 0) {
  console.error(`Schema validation FAILED for v${version}:`);
  errors.forEach(e => console.error(`  ✗ ${e}`));
  process.exit(1);
}

console.log(`✓ Schema v${version} valid: ${resourceCount} resources, ${Object.keys(schema.data_source_schemas ?? {}).length} data sources`);
