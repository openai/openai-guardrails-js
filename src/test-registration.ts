/**
 * Test file to verify auto-registration of built-in guardrails.
 *
 * This file demonstrates that importing the checks module automatically
 * registers all built-in guardrails with the defaultSpecRegistry.
 */

import { defaultSpecRegistry } from './registry';
import './checks'; // This should trigger auto-registration

console.log('Testing auto-registration of built-in guardrails...\n');

// Check what's registered
const allSpecs = defaultSpecRegistry.get_all();
const allMetadata = defaultSpecRegistry.get_all_metadata();

console.log(`Total registered guardrails: ${defaultSpecRegistry.size()}`);
console.log('\nRegistered guardrails:');
allMetadata.forEach((meta) => {
  console.log(`- ${meta.name}: ${meta.description}`);
  console.log(`  Media type: ${meta.mediaType}`);
  console.log(`  Has config: ${meta.hasConfig}`);
  console.log(`  Has context: ${meta.hasContext}`);
  console.log(`  Engine: ${meta.metadata?.engine || 'unknown'}`);
  console.log('');
});

// Test getting specific guardrails
const keywordsSpec = defaultSpecRegistry.get('keywords');
const urlsSpec = defaultSpecRegistry.get('urls');
const piiSpec = defaultSpecRegistry.get('pii');

console.log('Testing specific guardrail retrieval:');
console.log(`- keywords: ${keywordsSpec ? '✅ Found' : '❌ Not found'}`);
console.log(`- urls: ${urlsSpec ? '✅ Found' : '❌ Not found'}`);
console.log(`- pii: ${piiSpec ? '✅ Found' : '❌ Not found'}`);

if (keywordsSpec) {
  console.log('\nKeywords guardrail details:');
  console.log(`  Name: ${keywordsSpec.name}`);
  console.log(`  Description: ${keywordsSpec.description}`);
  console.log(`  Media type: ${keywordsSpec.mediaType}`);
  console.log(`  Config schema: ${keywordsSpec.configSchema ? 'Available' : 'None'}`);
}

export { allMetadata, allSpecs };
