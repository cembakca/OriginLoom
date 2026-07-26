import { getDeviceShell, getDeviceType } from "@originloom/shared/lib/device";
import type { MenuItem } from "@originloom/shared/lib/menu/types";
import {
  footerNavItems,
  linkRel,
  sortNavItems,
  topNavItems,
} from "@originloom/shared/lib/menu/utils";
import { describe, expect, it } from "vitest";

describe("device", () => {
  it("maps desktop UA to Desktop shell", () => {
    const req = new Request("http://localhost/", {
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X)" },
    });
    expect(getDeviceType(req)).toBe("Desktop");
    expect(getDeviceShell(getDeviceType(req))).toBe("desktop");
  });

  it("maps phone UA to Mobile shell", () => {
    const req = new Request("http://localhost/", {
      headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" },
    });
    expect(getDeviceType(req)).toBe("Mobile");
    expect(getDeviceShell(getDeviceType(req))).toBe("mobile");
  });

  it("maps tablet UA to mobile shell", () => {
    const req = new Request("http://localhost/", {
      headers: { "user-agent": "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)" },
    });
    expect(getDeviceType(req)).toBe("Tablet");
    expect(getDeviceShell(getDeviceType(req))).toBe("mobile");
  });
});

describe("menu utils", () => {
  const items: MenuItem[] = [
    { id: 2, name: "B", url: "/b", displayOrder: 2, mobileDisplayOrder: 1, itemType: 4 },
    { id: 1, name: "A", url: "/a", displayOrder: 1, mobileDisplayOrder: 2, itemType: 4 },
  ];

  it("sorts nav by displayOrder on desktop", () => {
    const sorted = sortNavItems(topNavItems(items), "desktop");
    expect(sorted.map((i) => i.name)).toEqual(["A", "B"]);
  });

  it("sorts nav by mobileDisplayOrder on mobile shell", () => {
    const sorted = sortNavItems(topNavItems(items), "mobile");
    expect(sorted.map((i) => i.name)).toEqual(["B", "A"]);
  });

  it("filters footer itemType 16", () => {
    const mixed: MenuItem[] = [
      ...items,
      { id: 3, name: "Footer", url: "/f", displayOrder: 1, mobileDisplayOrder: 1, itemType: 16 },
    ];
    expect(footerNavItems(mixed)).toHaveLength(1);
  });

  it("adds nofollow for pdf links", () => {
    expect(linkRel("/doc.pdf")).toBe("nofollow");
    expect(linkRel("/page")).toBeUndefined();
  });
});
