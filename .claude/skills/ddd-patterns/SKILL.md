---
name: ddd-patterns
description: "DDD code patterns and examples for domain, application, and infrastructure layers. Reference when implementing any module following layered architecture."
---

# DDD Implementation Patterns

Use these patterns when implementing modules. Adapt naming and import paths to match the project's existing conventions. Always read at least one existing module before writing code.

## Module folder structure

```
{module}/
├── domain/
│   ├── types.ts                          # Public API: domain type definitions
│   ├── {entity}.ts                       # Types + pure validation/business functions
│   ├── {entity}Repository.ts             # Repository contract (interface only)
│   └── errors.ts                         # Domain error types (optional)
├── application/
│   ├── {module}Error.ts                  # Module-scoped error class
│   └── {verb}{Entity}UseCase.ts          # Public API: one file per use case, exports pre-wired instance
├── infrastructure/
│   ├── session.ts                        # Public API: session utilities
│   ├── database.ts                       # Database type definition
│   ├── {Framework}{Adapter}.ts           # Framework-specific adapters
│   └── repositories/
│       └── {ORM}{Entity}Repository.ts    # Implements domain interface
└── schema/
    ├── enums.ts
    ├── {table}.ts
    └── relations.ts
```

## Result type

```typescript
export type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };
```

Always narrow before accessing branches:
```typescript
const result = validate(data);
if (!result.success) return result;       // TypeScript knows .error exists
const value = result.value;               // TypeScript knows .value exists
```

## Domain entity

All types and pure functions for one entity in one file:

```typescript
// domain/{entity}.ts
import { Result } from '{shared}/result';

export type Campaign = {
  id: string;
  brandId: string;
  name: string;
  budget: number;
  createdAt: Date;
};

export const createCampaign = (
  name: string,
  budget: number
): Result<Partial<Campaign>, Error> => {
  if (!name || name.trim().length === 0) {
    return { success: false, error: new Error("Campaign name cannot be empty.") };
  }
  if (budget <= 0) {
    return { success: false, error: new Error("Campaign budget must be positive.") };
  }
  return { success: true, value: { name, budget } };
};
```

## Repository interface

Contract only — defines what, not how:

```typescript
// domain/{entity}Repository.ts
import { Campaign } from "./campaign";

export type ICampaignRepository = {
  save: (campaign: Campaign) => Promise<void>;
  findByName: (name: string) => Promise<Campaign | null>;
};
```

## Use case

Higher-order function, one per file:

```typescript
// application/create{Entity}UseCase.ts
import { createCampaign, Campaign } from '../domain/campaign';
import { ICampaignRepository } from '../domain/campaignRepository';
import { Result } from '{shared}/result';

export const makeCreateCampaignUseCase = (
  campaignRepository: ICampaignRepository
) => {
  return async (data: {
    brandId: string;
    name: string;
    budget: number;
  }): Promise<Result<Campaign, Error>> => {
    const existing = await campaignRepository.findByName(data.name);
    if (existing) {
      return { success: false, error: new Error("Already exists.") };
    }

    const campaignResult = createCampaign(data.name, data.budget);
    if (!campaignResult.success) return campaignResult;

    const campaign: Campaign = {
      id: crypto.randomUUID(),
      brandId: data.brandId,
      name: campaignResult.value.name!,
      budget: campaignResult.value.budget!,
      createdAt: new Date(),
    };

    await campaignRepository.save(campaign);
    return { success: true, value: campaign };
  };
};
```

Multiple repositories as separate parameters when needed:
```typescript
export const makeAssignCreatorUseCase = (
  campaignRepo: ICampaignRepository,
  assignmentRepo: IAssignmentRepository  // separate dependency, never collapsed
) => { /* ... */ };
```

## Repository implementation

Factory function with soft-delete filter on every read:

```typescript
// infrastructure/repositories/{ORM}{Entity}Repository.ts
import { eq, and, isNull } from 'drizzle-orm';

export const makeCampaignRepository = (db: DatabaseType): ICampaignRepository => ({
  async findByName(name: string): Promise<Campaign | null> {
    const result = await db.select().from(campaigns)
      .where(and(eq(campaigns.name, name), isNull(campaigns.deletedAt)))
      .limit(1);
    if (result.length === 0) return null;
    return mapToCampaign(result[0]);
  },

  async save(campaign: Campaign): Promise<void> {
    await db.insert(campaigns).values({ /* ... */ });
  },
});
```

## Module error class

```typescript
// application/{module}Error.ts
export class CampaignError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'CampaignError';
  }
}
```

## Module Public API

Each use case file exports its own pre-wired instance. There is NO `index.ts` barrel, NO `use-cases.ts`, and NO re-export files of any kind:

```typescript
// application/createCampaignUseCase.ts — exports pre-wired instance
import { makeCampaignRepository } from '../infrastructure/repositories/...';
import { db } from '../infrastructure/database';

const campaignRepository = makeCampaignRepository(db);

export const makeCreateCampaignUseCase = (campaignRepository: ICampaignRepository) => {
  return async (data: { /* ... */ }): Promise<Result<Campaign, Error>> => {
    // ... use case logic
  };
};

export const createCampaign = makeCreateCampaignUseCase(campaignRepository);

// domain/types.ts — public domain type definitions
export type { Campaign } from './campaign';
export { CampaignError } from '../application/campaignError';
```

Consumers import directly from each source file:
```typescript
import { createCampaign } from '@/modules/campaigns/application/createCampaignUseCase';
import type { Campaign } from '@/modules/campaigns/domain/types';
import { getSession } from '@/modules/campaigns/infrastructure/session';
import type { Principal } from '@/packages/@core/identity';
```

## ORM / Database Boundary

ORM libraries, database clients, query builders, and schema table imports are ONLY allowed in repository files inside `infrastructure/repositories/`. This is the single most important boundary in the architecture.

**Only repositories touch the database:**
```typescript
// ✅ CORRECT — ORM imports in a repository
// infrastructure/repositories/DrizzleCampaignRepository.ts
import { eq, and, isNull } from 'drizzle-orm';
import { campaigns } from '../../schema/campaigns';
import { db } from '../database';

export const makeCampaignRepository = (db: DatabaseType): ICampaignRepository => ({
  // ... repository methods with ORM queries
});
```

**Use cases never write database queries:**
```typescript
// ❌ VIOLATION — ORM utilities + schema in a use case = writing queries
// application/listUsersUseCase.ts
import { asc, isNull } from 'drizzle-orm';       // FORBIDDEN — ORM utility
import { users } from '../../schema/users';        // FORBIDDEN — schema table
const data = await db.select().from(users);        // FORBIDDEN — query builder

// ✅ CORRECT — use case receives a repository interface
// application/listUsersUseCase.ts
import type { IUserRepository } from '../domain/userRepository';

export const makeListUsersUseCase = (userRepo: IUserRepository) => {
  return async () => userRepo.findAll();
};

// ✅ ALSO CORRECT — pre-wired section imports db handle for composition
import { db } from '@/lib/db';                     // ALLOWED — composition wiring
import { makeUserRepository } from '../infrastructure/repositories/DrizzleUserRepository';

const userRepo = makeUserRepository(db);           // db passed to factory, never used directly
export const listUsers = makeListUsersUseCase(userRepo);
```

**app/ files never touch the database:**
```typescript
// ❌ VIOLATION — database access in page.tsx
import { db } from '@/lib/db';
import { eq } from 'drizzle-orm';
const data = await db.select().from(users);

// ✅ CORRECT — call pre-wired use case
import { listUsers } from '@/modules/users/application/listUsersUseCase';
const result = await listUsers();
```

## API route (thin adapter)

Routes are thin HTTP adapters. They call pre-wired use cases — never wire repositories directly:

```typescript
// app/api/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createCampaign } from '@/modules/campaigns/application/createCampaignUseCase'
import { getSession } from '@/modules/campaigns/infrastructure/session'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const result = await createCampaign({
    brandId: body.brandId,
    name: body.name,
    budget: body.budget,
  })

  if (result.success) {
    return NextResponse.json(result.value, { status: 201 })
  }
  return NextResponse.json({ error: result.error.message }, { status: 400 })
}
```
