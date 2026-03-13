/**
 * Tests for tenant scoping helpers
 * Verifies that scopeWhere correctly adds agencyId to where clauses
 */

import { describe, it, expect } from "vitest";
import { scopeWhere, verifyOwnership } from '.ts';

describe("tenantScope helpers", () => {
  describe("scopeWhere", () => {
    it("should add agencyId to where clause", () => {
      const agencyId = "agency-1";
      const where = { status: "OPEN" };

      const result = scopeWhere(agencyId, where);

      expect(result).toEqual({
        agencyId: "agency-1",
        status: "OPEN",
      });
    });

    it("should work with empty where clause", () => {
      const agencyId = "agency-1";

      const result = scopeWhere(agencyId, {});

      expect(result).toEqual({
        agencyId: "agency-1",
      });
    });

    it("should work with undefined where clause", () => {
      const agencyId = "agency-1";

      const result = scopeWhere(agencyId, undefined);

      expect(result).toEqual({
        agencyId: "agency-1",
      });
    });

    it("should preserve existing where conditions", () => {
      const agencyId = "agency-1";
      const where = {
        status: "OPEN",
        type: "APPROVAL_REQUIRED",
        OR: [{ field1: "value1" }, { field2: "value2" }],
      };

      const result = scopeWhere(agencyId, where);

      expect(result).toEqual({
        agencyId: "agency-1",
        status: "OPEN",
        type: "APPROVAL_REQUIRED",
        OR: [{ field1: "value1" }, { field2: "value2" }],
      });
    });
  });
});


