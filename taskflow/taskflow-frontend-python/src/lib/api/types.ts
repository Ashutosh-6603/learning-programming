// The app's names for the contract's schemas. schema.d.ts is generated from contract/openapi.yaml
// (`npm run api:generate`); never edit it, change the contract and regenerate.
import type { components } from './schema';

type Schemas = components['schemas'];

export type Role = Schemas['Role'];
export type InvitableRole = Schemas['InvitableRole'];
export type Priority = Schemas['Priority'];
export type Problem = Schemas['Problem'];
export type FieldError = Schemas['FieldError'];

export type UserSummary = Schemas['UserSummary'];
export type User = Schemas['User'];
export type AccessToken = Schemas['AccessToken'];
export type AuthSession = Schemas['AuthSession'];

export type Workspace = Schemas['Workspace'];
export type Member = Schemas['Member'];
export type Invitation = Schemas['Invitation'];
export type Project = Schemas['Project'];

export type Column = Schemas['Column'];
export type Task = Schemas['Task'];
export type BoardColumn = Schemas['BoardColumn'];
export type Board = Schemas['Board'];
export type CreateTaskBody = Schemas['CreateTaskRequest'];
/** JSON merge-patch semantics: absent = unchanged, null = cleared. */
export type UpdateTaskBody = Schemas['UpdateTaskRequest'];

export type Comment = Schemas['Comment'];
export type Attachment = Schemas['Attachment'];
export type ActivityEvent = Schemas['ActivityEvent'];
export type SearchHit = Schemas['SearchHit'];

/** Server → client WebSocket envelopes (README §9.2), a union discriminated by `type`. */
export type ServerMessage = Schemas['WsServerMessage'];
