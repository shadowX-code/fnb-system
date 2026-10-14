import { it } from 'vitest';
import {
  profileFields,
  sanitizeInboxProfile,
} from "../../../../supabase/functions/_shared/metaInboxProfile.ts";
function assert(v: unknown) {
  if (!v) throw new Error("profile contract failed");
}
it(
  "profile reads use only official minimal fields and cannot request a different channel",
  () => {
    assert(profileFields("instagram") === "name,username,profile_pic");
    assert(profileFields("facebook") === "first_name,last_name,profile_pic");
    let failed = false;
    try {
      profileFields("internal");
    } catch {
      failed = true;
    }
    assert(failed);
  },
);
it(
  "profile projection preserves unavailable fields and excludes unrelated data and unsafe URLs",
  () => {
    const result = sanitizeInboxProfile(
      {
        name: null,
        username: "real_customer",
        profile_pic:
          "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=example",
        gender: "secret",
        id: "private",
      },
      "instagram",
    );
    assert(
      result.display_name === null &&
        result.handle === "real_customer" &&
        result.available &&
        !("gender" in result) &&
        !("id" in result),
    );
    assert(
      sanitizeInboxProfile(
        { profile_pic: "https://attacker.invalid/avatar" },
        "facebook",
      ).avatar_url === null,
    );
    assert(
      sanitizeInboxProfile(
        {
          first_name: "Actual",
          last_name: "Name",
          profile_pic: "https://cdn.fbcdn.net/avatar?access_token=secret",
        },
        "facebook",
      ).avatar_url === null,
    );
    assert(sanitizeInboxProfile({}, "facebook").available === false);
  },
);
