import assert from "node:assert/strict";
import test from "node:test";

import {
  assuranceLabel,
  declaredPermissions,
  declaredStepUp,
  hasStepUpGuard,
  isAuthenticated,
  parseControllerSource,
} from "./check-route-inventory.mjs";

const MULTI_LINE = `
@Controller(
  'things',
)
@UseGuards(
  SupabaseAuthGuard,
  PermissionsGuard,
)
export class ThingsController {
  @Post(
    ':id',
  )
  @RequirePermission(
    PERMISSIONS.TENANT_MANAGE_PLATFORM,
    PERMISSIONS.ROLE_MANAGE,
  )
  @UseGuards(
    StepUpGuard,
  )
  @RequireStepUp(
    STEP_UP_ACTIONS.ROLE_CHANGE,
  )
  async update() {}
}
`;

test("parses decorators that span several lines", () => {
  const [route] = parseControllerSource(
    MULTI_LINE,
    "domains/things/things.controller.ts",
  );

  assert.equal(route.method, "POST");
  assert.equal(route.path, "/things/:id");
  assert.equal(route.handler, "update");
  assert.equal(isAuthenticated(route.decorators), true);
  assert.equal(hasStepUpGuard(route.decorators), true);
  assert.deepEqual(declaredPermissions(route.decorators), [
    "TENANT_MANAGE_PLATFORM",
    "ROLE_MANAGE",
  ]);
  assert.deepEqual(declaredStepUp(route.decorators), {
    actions: ["ROLE_CHANGE"],
    malformed: false,
  });
  assert.equal(
    assuranceLabel(
      ["ROLE_CHANGE"],
      new Map([["ROLE_CHANGE", { code: "role.change", mfa: true }]]),
    ),
    "mfa+step-up:role.change",
  );
});

test("inherits class-level guards and step-up metadata", () => {
  const [route] = parseControllerSource(
    `
@Controller('global')
@UseGuards(
  SupabaseAuthGuard,
  StepUpGuard,
)
@RequireStepUp(STEP_UP_ACTIONS.TENANT_CHANGE)
export class GlobalController {
  @Get()
  list() {}
}
`,
    "domains/global/global.controller.ts",
  );

  assert.equal(isAuthenticated(route.decorators), true);
  assert.equal(hasStepUpGuard(route.decorators), true);
  assert.deepEqual(declaredStepUp(route.decorators), {
    actions: ["TENANT_CHANGE"],
    malformed: false,
  });
});

test("does not match guards or permissions by substring", () => {
  const [route] = parseControllerSource(
    `
@Controller('safe')
@UseGuards(NotSupabaseAuthGuard)
export class SafeController {
  @Get()
  @NotRequirePermission(PERMISSIONS.TICKET_READ)
  @UseGuards(NotStepUpGuard)
  @RequireStepUp(STEP_UP_ACTIONS.ROLE_CHANGE)
  list() {}
}
`,
    "domains/safe/safe.controller.ts",
  );

  assert.equal(isAuthenticated(route.decorators), false);
  assert.equal(hasStepUpGuard(route.decorators), false);
  assert.deepEqual(declaredPermissions(route.decorators), []);
  assert.deepEqual(declaredStepUp(route.decorators), {
    actions: ["ROLE_CHANGE"],
    malformed: false,
  });
});

test("flags a step-up action that is not a constant", () => {
  const [route] = parseControllerSource(
    `
@Controller('unsafe')
export class UnsafeController {
  @Post()
  @RequireStepUp('role.change')
  create() {}
}
`,
    "domains/unsafe/unsafe.controller.ts",
  );

  assert.deepEqual(declaredStepUp(route.decorators), {
    actions: [],
    malformed: true,
  });
});
