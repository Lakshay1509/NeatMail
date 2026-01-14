import { db } from "@/lib/prisma";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import z from "zod/v3";
import { colors } from "@/lib/colors";

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
        tags: z.array(z.string()).min(1).max(8),
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

      await db.user_tags.deleteMany({
        where: {
          user_id: userId,
        },
      });

      const response = await db.user_tags.createMany({
        data: tagRecords.map((tag) => ({
          user_id: userId,
          tag_id: tag.id,
        })),
        skipDuplicates: true,
      });

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
          name: values.tag,
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

      if (!exist) {
        return ctx.json({ error: "Error getting data for this tag" }, 500);
      }

      const data = await db.tag.delete({
        where: {
          id: exist.id,
        },
      });

      if (!data) {
        return ctx.json({ error: "Error deleting data for this tag" }, 500);
      }

      return ctx.json({ data }, 200);
    }
  );

export default app;
