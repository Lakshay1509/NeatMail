import { db } from "@/lib/prisma";
import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import z from "zod/v3";
import { colors } from "@/lib/colors";
import { google } from "googleapis";
import { getGmailClient } from "@/lib/gmail";
import { getTagsUser } from "@/lib/supabase";
import { addUserLabel, deleteUserLabel } from "@/lib/model";
import { inngest } from "@/lib/inngest";

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

      //use txn

      const values = ctx.req.valid("json");

      const tagRecords = await db.tag.findMany({
        where: {
          name: { in: values.tags },

          OR: [
            { user_id: userId },
            { user_id: null }, // System tags
          ],
        },
      });

      const response = await db.$transaction([
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
      ]);

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
        tag: z.string(),
        color: z.string(),
        description: z.string(),
      }),
    ),
    async (ctx) => {
      const { userId } = await auth();
      if (!userId) {
        return ctx.json({ error: "Unuathorized" }, 401);
      }

      const values = ctx.req.valid("json");

      const exist = await db.tag.findFirst({
        where: {
          name: values.tag.trim(),
          OR: [{ user_id: userId }, { user_id: null }],
        },
      });

      const colorExist = colors.some((color) => color.value === values.color);

      if (exist || !colorExist) {
        return ctx.json(
          { error: "Same name tag exists or color invalid" },
          500,
        );
      }

      const [data, addTagToUser] = await db.$transaction(async (tx) => {
        const tag = await tx.tag.create({
          data: {
            name: values.tag.trim(),
            user_id: userId,
            color: values.color,
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

      // Fire and forget — runs in background, user gets instant response
      await inngest.send({
        name: "tag/label.add",
        data: {
          user_id: userId,
          tag_id: data.id,
          label_name: values.tag.trim().toLowerCase(),
          description: values.description,
        },
      });

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
        const clerk = await clerkClient();

        const values = ctx.req.valid("json");

        const exist = await db.tag.findFirst({
          where: {
            id: values.id,
            user_id: userId,
          },
        });

        if (!exist) {
          return ctx.json({ error: "Error getting data for this tag" }, 500);
        }

        const gmail = await getGmailClient(userId)

        const { data } = await gmail.users.labels.list({
          userId: "me",
          fields: "labels(id,name)", 
        });

        const gmailLabel = data.labels?.find(
          (label) => label.name === exist.name,
        );

        if (gmailLabel && gmailLabel.id) {
          await gmail.users.labels.delete({
            userId: "me",
            id: gmailLabel.id,
          });
        }

        const response = await db.tag.delete({
          where: {
            id: exist.id,
          },
        });

        //todo revert when failed
        await deleteUserLabel({
          user_id:userId,
          label_name:exist.name.toLowerCase()
        })

        if (!response) {
          return ctx.json({ error: "Error deleting data for this tag" }, 500);
        }

        return ctx.json({ response }, 200);
      } catch (error) {
        return ctx.json({ error }, 500);
      }
    },
  );

export default app;
