import { NextApiRequest, NextApiResponse } from "next";

import { prisma } from "../../server/db/client";
import { Prisma, Proposal } from "@prisma/client";

const getInfo = async (req: NextApiRequest, res: NextApiResponse) => {
  const { realmPubKey, start, end } = req.body;

  try {
    const proposalInfo = await prisma.proposal.findMany({
      where: {
        realmPubKey,
        createdAt: {
          gte: start,
          lte: end,
        },
      },
    });

    const voteRecordInfo = await prisma.voteRecord.findMany({
      where: {
        realmPubKey,
        proposalCreatedAt: {
          gte: start,
          lte: end,
        },
      },
    });

    console.log(voteRecordInfo);

    const parsedProposalInfo = parseInfo(proposalInfo);
    const parsedVoteRecordInfo = parseInfo(voteRecordInfo);

    return res.status(200).json({
      proposals: parsedProposalInfo,
      voteRecords: parsedVoteRecordInfo,
    });
  } catch (e) {
    console.log(e);
    return res.status(500).json({ success: false, error: e });
  }

  function parseInfo<T>(info: T[]): T[] {
    return JSON.parse(
      JSON.stringify(info, (key, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    );
  }
};

export default getInfo;
