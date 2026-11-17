import { describe, expect, it } from 'vitest';
import { can } from './permissions';

describe('can', () => {
  it('lets members and up edit tasks, but not viewers', () => {
    expect(can.editTasks('viewer')).toBe(false);
    expect(can.editTasks('member')).toBe(true);
    expect(can.editTasks('owner')).toBe(true);
  });

  it('only lets owners invite admins', () => {
    expect(can.invitableRoles('owner')).toEqual(['admin', 'member', 'viewer']);
    expect(can.invitableRoles('admin')).toEqual(['member', 'viewer']);
    expect(can.invitableRoles('member')).toEqual([]);
  });

  it('lets admins manage members and viewers, but not other admins or owners', () => {
    expect(can.assignableRoles('admin', 'member')).toEqual(['member', 'viewer']);
    expect(can.assignableRoles('admin', 'admin')).toEqual([]);
    expect(can.removeMember('admin', 'viewer')).toBe(true);
    expect(can.removeMember('admin', 'owner')).toBe(false);
    expect(can.removeMember('owner', 'admin')).toBe(true);
  });
});
