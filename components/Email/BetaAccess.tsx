import {
  Html,
  Body,
  Text,
} from "@react-email/components";

interface BetaAccessEmailProps {
  activationLink: string;
}

export default function BetaAccessEmail({
  activationLink,
}: BetaAccessEmailProps) {
  return (
    <Html>
      <Body style={body}>
        <Text style={paragraph}>
          Hey there,
        </Text>

        <Text style={paragraph}>
          Your NeatMail beta access is now live.
        </Text>

        <Text style={paragraph}>
          <a href={activationLink} style={link}>
            Get started
          </a>{" "}
          — takes about 2 minutes.
        </Text>

        <Text style={smallText}>
          Google may show an "unverified app" screen — just click Advanced
          &rarr; Go to NeatMail. That's normal for early-stage apps.
        </Text>

        <Text style={paragraph}>
          Let me know if anything comes up.
        </Text>

        <Text style={paragraph}>
          — Lakshay
          <br />
          Founder, NeatMail
        </Text>
      </Body>
    </Html>
  );
}

const body = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  padding: "16px",
};

const paragraph = {
  fontSize: "15px",
  lineHeight: "1.6",
  color: "#222222",
  margin: "0 0 14px",
};

const smallText = {
  fontSize: "13px",
  lineHeight: "1.5",
  color: "#666666",
  margin: "0 0 14px",
};

const link = {
  color: "#111111",
  textDecoration: "underline",
};
