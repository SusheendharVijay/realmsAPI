import { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import { prisma } from "../../server/db/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime";

const unsubscribe = async (req: NextApiRequest, res: NextApiResponse) => {
  const { realmPubKey } = req.body;
  try {
    const update = await prisma.realms.update({
      where: { pubkey: realmPubKey },
      data: {
        subscribed: false,
      },
    });

    return res.status(200).json(update);
  } catch (e) {
    console.log(e);
    if (e instanceof PrismaClientKnownRequestError) {
      console.log(e.meta?.cause);
      return res.status(500).json({ success: false, error: e.meta?.cause });
    }

    return res.status(500).json({ success: false, error: e });
  }
};

export default unsubscribe;
