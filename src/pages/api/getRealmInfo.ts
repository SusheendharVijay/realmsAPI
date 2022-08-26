import { getDevnetConnection } from "./../../utils/general";
import { NextApiRequest, NextApiResponse } from "next";
import { getGovernance } from "@solana/spl-governance";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import NextCors from "nextjs-cors";

const InfoSchema = z.object({
  councilMintGovPk: z.string().transform((v) => new PublicKey(v)),
});

const getRealmInfo = async (req: NextApiRequest, res: NextApiResponse) => {
  await NextCors(req, res, {
    // Options
    methods: ["GET"],
    origin: "*",
    optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
  });
  try {
    const connection = getDevnetConnection();
    const { councilMintGovPk } = InfoSchema.parse(req.body);

    const governance = await getGovernance(connection, councilMintGovPk);

    const info = {
      quorumPercentage: governance.account.config.voteThresholdPercentage.value,
      proposalCount: governance.account.proposalCount,
      votingProposalCount: governance.account.votingProposalCount,
      maxVotingTime: governance.account.config.maxVotingTime,
      minCouncilTokensToCreateProposal:
        governance.account.config.minCouncilTokensToCreateProposal,
    };

    return res.status(200).json(info);
  } catch (e) {
    console.log(e);
    return res.status(500).json({ error: e });
  }
};
export default getRealmInfo;
