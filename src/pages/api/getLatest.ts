import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../server/db/client";

type RawSqlResponse = {
  "MAX(proposalCreatedAt)": bigint;
};
const getLatest = async (req: NextApiRequest, res: NextApiResponse) => {
  try {
    const [latest]: [RawSqlResponse] =
      await prisma.$queryRaw`SELECT MAX(proposalCreatedAt) FROM VoteRecord`;

    console.log(Number(latest["MAX(proposalCreatedAt)"]));
    return res.status(200).json({ success: true });
  } catch (e) {
    console.log(e);
    return res.status(200).json({ success: false });
  }
};

export default getLatest;
