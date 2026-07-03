// =============================================================================
// Auth Module — Drizzle Relations
// =============================================================================
// Defines ORM-level relations for the Auth module's schema.
//
// The Auth module has a single table (credentials) with no intra-module
// relations. This file is included for structural consistency with other
// Core modules and to explicitly document the absence of intra-module joins.
//
// Cross-module references (principalId → Identity module) are soft links
// (plain text IDs) and intentionally have NO relation definitions here.
// Cross-module ORM relations would violate the Axiom of Isolation.
// =============================================================================

import { relations } from 'drizzle-orm';

import { credentials } from './credentials';

export const credentialsRelations = relations(credentials, () => ({}));
