// =============================================================================
// Identity Module — Drizzle Relations
// =============================================================================
// Defines ORM-level relations for the Identity module's schema.
//
// The Identity module has a single table (identityPrincipals) with no
// intra-module relations. This file is included for structural consistency
// with other Core modules and to explicitly document the absence of
// intra-module joins.
//
// Cross-module references (other modules referencing principalId) are soft
// links (plain text IDs) and intentionally have NO relation definitions here.
// Cross-module ORM relations would violate the Axiom of Isolation.
// =============================================================================

import { relations } from 'drizzle-orm';

import { identityPrincipals } from './principals';

export const identityPrincipalsRelations = relations(identityPrincipals, () => ({}));
