import { db } from "@/lib/prisma";
import { auth} from "@clerk/nextjs/server";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { colors, outlook_colors } from "@/lib/colors";
import { getGmailClient } from "@/lib/gmail";
import { getUserTier, checkFeatureLimit } from "@/lib/tier-guard";
import { followUpBlocksResolvedRemoval } from "@/lib/tags";
import z from "zod";



const app = new Hono()

  .get("/", async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unuathorized" }, 401);
    }

    const data = await db.user_tags.findMany({
      where: {
        user_id: userId,
      },
      include: {
        tag: {
          select: {
            name: true,
            id:true
          },
        },
      },
    });

    return ctx.json({ data }, 200);
  })

  .get("/custom", async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unuathorized" }, 401);
    }

    const data = await db.tag.findMany({
      where: {
        user_id: userId,
      },
      select: {
        name: true,
        color: true,
        id: true,
        description:true
      },
    });

    return ctx.json({ data }, 200);
  })

  .get("/fromGmail", async (ctx) => {
    const { userId } = await auth();
    if (!userId) {
      return ctx.json({ error: "Unuathorized" }, 401);
    }
    const gmail = await getGmailClient(userId);

    const EXCLUDED_LABELS = new Set([
      "[Imap]/Drafts",
      "Unsubscribed Emails",
      "Conversation History",
    ]);

    const labelsResponse = await gmail.users.labels.list({ userId: "me" });

    const filteredLabels = (labelsResponse.data.labels || [])
      .filter((label) => label.type === "user")
      .filter((label) => !EXCLUDED_LABELS.has(label.name!))
      .map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
      }));

    const labelsInDb = await db.tag.findMany({
      where: {
        OR: [{ user_id: userId }, { user_id: null }],
      },
      select: {
        name: true,
      },
    });

    const dbTagNameSet = new Set(
      labelsInDb.map((l) => l.name.toLowerCase().trim()),
    );

    const gmailUserLabels = filteredLabels;

    const labelsNotInDb = gmailUserLabels
      .map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
      }))
      .filter((label) => !dbTagNameSet.has(label.name!.toLowerCase().trim()));

    return ctx.json({ labelsNotInDb }, 200);
  })

  .post(
    "/addTagtoUser",
    zValidator(
      "json",
      z.object({
        tags: z.array(z.string()).min(1).max(30),
      }),
    ),
    async (ctx) => {
      const { userId } = await auth();
      if (!userId) {
        return ctx.json({ error: "Unuathorized" }, 401);
      }

      const tier = await getUserTier(userId);
      if (tier === "FREE") {
        return ctx.json({ error: "Upgrade to Pro to set up categories" }, 403);
      }

      const values = ctx.req.valid("json");

      // "Resolved" cannot be removed while follow-ups are enabled — the
      // follow-up feature depends on it to close out tracked threads.
      if (await followUpBlocksResolvedRemoval(db, userId, values.tags)) {
        return ctx.json(
          {
            error:
              'The "Resolved" category is required while follow-ups are enabled. Turn off follow-ups before removing it.',
          },
          400,
        );
      }

      const tagRecords = await db.tag.findMany({
        where: {
          name: { in: values.tags },

          OR: [
            { user_id: userId },
            { user_id: null }, // System tags
          ],
        },
      });

      const activeTagIds = tagRecords.map((tag) => tag.id);

      const ops = [
        db.user_tags.deleteMany({
          where: {
            user_id: userId,
          },
        }),
        db.user_tags.createMany({
          data: tagRecords.map((tag) => ({
            user_id: userId,
            tag_id: tag.id,
          })),
          skipDuplicates: true,
        }),
      ];

      // Turning a label off deactivates its archive rule too (not deleted, so
      // the duration survives). Re-enabling the label doesn't re-arm the rule —
      // that's a deliberate re-enable via the dialog, not a side effect here.
      if (activeTagIds.length > 0) {
        ops.push(
          db.archiveRule.updateMany({
            where: {
              user_id: userId,
              tag_id: { not: null, notIn: activeTagIds },
              isActive: true,
            },
            data: { isActive: false },
          }),
        );
      }

      const response = await db.$transaction(ops);

      if (!response) {
        return ctx.json({ error: "Error creating tags" }, 500);
      }

      return ctx.json({ response }, 200);
    },
  )

  .post(
    "/create-custom",
    zValidator(
      "json",
      z.object({
        // Kept short — name + description are injected into the classification
        // LLM prompt, so unbounded input would bloat/poison the context.
        tag: z.string().trim().min(1).max(50),
        color: z.string(),
        description: z.string().trim().min(10).max(200),
        outlookColor: z.string().optional(),
      }),
    ),
    async (ctx) => {
      const { userId } = await auth();
      if (!userId) {
        return ctx.json({ error: "Unuathorized" }, 401);
      }

      const values = ctx.req.valid("json");

      const labelCount = await db.tag.count({
        where: { user_id: userId },
      });

      const limitCheck = await checkFeatureLimit(userId, "maxCustomLabels", labelCount);

      if (!limitCheck.allowed) {
        return ctx.json({ error: limitCheck.reason }, 402);
      }

      const exist = await db.tag.findFirst({
        where: {
          name: values.tag.trim(),
          OR: [{ user_id: userId }, { user_id: null }],
        },
      });

      const colorGmailExist = colors.some(
        (color) => color.value === values.color,
      );
      const colorOutlookExist = outlook_colors.some(
        (color) => color.color === values.color,
      );

      if (exist) {
        return ctx.json({ error: "Same name tag exists" }, 500);
      }

      if (!colorGmailExist && !colorOutlookExist) {
        return ctx.json({ error: "No color exists" }, 500);
      }

      const [data, addTagToUser] = await db.$transaction(async (tx) => {
        const tag = await tx.tag.create({
          data: {
            name: values.tag.trim(),
            user_id: userId,
            color: values.color,
            outlook_preset: values.outlookColor,
            description: values.description,
          },
        });

        const addTagToUser = await tx.user_tags.create({
          data: {
            user_id: userId,
            tag_id: tag.id,
          },
        });

        return [tag, addTagToUser];
      });

      if (!data || !addTagToUser) {
        return ctx.json({ error: "Error creating tag" }, 500);
      }

      // TODO: enqueue tag/label.add job to BullMQ if background processing is needed

      return ctx.json({ data }, 200);
    },
  )

  .delete(
    "/custom",
    zValidator(
      "json",
      z.object({
        id: z.string(),
      }),
    ),
    async (ctx) => {
      try {
        const { userId } = await auth();
        if (!userId) {
          return ctx.json({ error: "Unuathorized" }, 401);
        }

        const values = ctx.req.valid("json");

        const exist = await db.tag.findFirst({
          where: {
            id: values.id,
            user_id: userId,
          },
        });

        const userData = await db.user_tokens.findUnique({
          where: { clerk_user_id: userId },
          select: {
            is_gmail: true,
          },
        });

        if (!exist) {
          return ctx.json({ error: "Error getting data for this tag" }, 500);
        }

        if (!userData) {
          return ctx.json({ error: "Error getting user data" }, 500);
        }

        // try {
        //   if (userData.is_gmail === true) {
        //     const gmail = await getGmailClient(userId);

        //     const { data } = await gmail.users.labels.list({
        //       userId: "me",
        //       fields: "labels(id,name)",
        //     });

        //     const gmailLabel = data.labels?.find(
        //       (label) => label.name === exist.name,
        //     );

        //     if (gmailLabel && gmailLabel.id) {
        //       await gmail.users.labels.delete({
        //         userId: "me",
        //         id: gmailLabel.id,
        //       });
        //     }
        //   } else {
        //     await deleteOutlookTag(userId, exist.name);
        //   }
        // } catch (error) {
        //   return ctx.json({ error: "Error deleting tag" }, 500);
        // }

        const response = await db.tag.delete({
          where: {
            id: exist.id,
          },
        });

        //todo revert when failed
        // await deleteUserLabel({
        //   user_id:userId,
        //   label_name:exist.name.toLowerCase()
        // })

        if (!response) {
          return ctx.json({ error: "Error deleting data for this tag" }, 500);
        }

        return ctx.json({ response }, 200);
      } catch (error) {
        return ctx.json({ error }, 500);
      }
    },
  )

  .put(
    "/custom",
    zValidator(
      "json",
      z.object({
        id: z.string().min(1),
        // Only the description is editable. Name and color are immutable: the
        // name is the key we use to find/create the Gmail label and drive
        // classification, and the color is tied to the existing Gmail label —
        // changing either here would silently desync from Gmail.
        description: z.string().trim().min(10).max(200),
      }),
    ),
    async (ctx) => {
      const { userId } = await auth();
      if (!userId) {
        return ctx.json({ error: "Please sign in to edit this label." }, 401);
      }

      const values = ctx.req.valid("json");

      // Only the owner's own custom tags are editable. System tags (user_id
      // null) and other users' tags must never be reachable here.
      const existing = await db.tag.findFirst({
        where: { id: values.id, user_id: userId },
      });

      if (!existing) {
        return ctx.json(
          {
            error:
              "We couldn't find that label, or you don't have permission to edit it.",
          },
          404,
        );
      }

      try {
        const data = await db.tag.update({
          where: { id: existing.id },
          data: {
            description: values.description,
          },
        });

        return ctx.json({ data }, 200);
      } catch (error) {
        console.error("Error updating custom tag", error);
        return ctx.json(
          {
            error:
              "Something went wrong while updating your label. Please try again.",
          },
          500,
        );
      }
    },
  );

export default app;
