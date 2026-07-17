import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// @ts-expect-error test-only global flag React's act() checks for
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);
