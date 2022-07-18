import { Proposal, VoteRecord } from "@prisma/client";
import { NextApiRequest, NextApiResponse } from "next";

import { prisma } from "../../server/db/client";
import { z } from "zod";

const getInfoObject = z.object({
  realmPubKey: z.string().length(44).or(z.string().length(43)),
  start: z.number().nonnegative().nullish(),
  end: z.number().nonnegative().nullish(),
});

const getInfo = async (req: NextApiRequest, res: NextApiResponse) => {
  const { realmPubKey, start, end } = getInfoObject.parse(req.body);

  if (start && end && start > end) {
    return res
      .status(400)
      .json({ success: false, error: "start cannot be greater than end" });
  }

  const min = start ?? 0;
  const max = end ?? new Date().getTime();

  try {
    const proposalInfo = await prisma.proposal.findMany({
      where: {
        realmPubKey,
        createdAt: {
          gte: min,
          lte: max,
        },
      },
    });

    const voteRecordInfo = await prisma.voteRecord.findMany({
      where: {
        realmPubKey,
        proposalCreatedAt: {
          gte: min,
          lte: max,
        },
      },
    });

    const parsedProposalInfo = parseInfo(proposalInfo);
    const parsedVoteRecordInfo = parseInfo(voteRecordInfo);

    return res.status(200).json({
      proposalCount: parsedProposalInfo.length,
      voteRecordCount: parsedVoteRecordInfo.length,
      proposals: parsedProposalInfo.sort((a, b) =>
        Number(b.createdAt - a.createdAt)
      ),
      voteRecords: parsedVoteRecordInfo.sort((a, b) =>
        Number(b.proposalCreatedAt - a.proposalCreatedAt)
      ),
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
