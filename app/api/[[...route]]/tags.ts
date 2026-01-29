import { db } from "@/lib/prisma";
import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import z from "zod/v3";
import { colors } from "@/lib/colors";
import { google } from "googleapis";

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

  .post(
    "/create",
    zValidator(
      "json",
      z.object({
        tags: z.array(z.string()).min(1).max(30),
      })
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
    }
  )

  .post(
    "/create-custom",
    zValidator(
      "json",
      z.object({
        tag: z.string(),
        color: z.string(),
      })
    ),
    async (ctx) => {
      const { userId } = await auth();
      if (!userId) {
        return ctx.json({ error: "Unuathorized" }, 401);
      }

      //use txn

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
          500
        );
      }

      const data = await db.tag.create({
        data: {
          name: values.tag,
          user_id: userId,
          color: values.color,
        },
      });

      if (!data) {
        return ctx.json({ error: "Error creating tag" }, 500);
      }

      return ctx.json({ data }, 200);
    }
  )

  .delete(
    "/custom",
    zValidator(
      "json",
      z.object({
        id: z.string(),
      })
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

        const googleAccount = (
          await clerk.users.getUserOauthAccessToken(userId, "google")
        ).data.find((acc) => acc.token);

        if (!googleAccount?.token) {
          throw new Error("No valid Google access token found");
        }

        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: googleAccount.token });

        const gmail = google.gmail({ version: "v1", auth: oauth2Client });

        const { data } = await gmail.users.labels.list({
          userId: "me",
          fields: "labels(id,name)", // Only fetch what you need
        });

        const gmailLabel = data.labels?.find(
          (label) => label.name === exist.name
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

        if (!response) {
          return ctx.json({ error: "Error deleting data for this tag" }, 500);
        }

        return ctx.json({ response }, 200);
      } catch (error) {
        return ctx.json({ error }, 500);
      }
    }
  );

export default app;
