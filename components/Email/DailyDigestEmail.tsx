import {
  Html,
  Body,
  Container,
  Head,
  Heading,
  Text,
  Section,
  Hr,
  Preview,
} from "@react-email/components";

interface DigestEmail {
  ai_summary: string | null;
  ai_action: string | null;
  from: string;
  ageText: string;
}

interface DigestGroup {
  urgency: "urgent" | "needs_reply" | "new_today";
  label: string;
  emails: DigestEmail[];
}

interface DailyDigestEmailProps {
  totalEmails: number;
  dateLabel: string;
  groups: DigestGroup[];
  remainingCount?: number;
}

const COLORS = {
  urgent: "#DC2626",
  needs_reply: "#D97706",
  new_today: "#059669",
};

export default function DailyDigestEmail({
  totalEmails,
  dateLabel,
  groups,
  remainingCount,
}: DailyDigestEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        {dateLabel}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={heading}>Morning briefing</Heading>
            <Text style={date}>{dateLabel}</Text>
          </Section>

          <Hr style={divider} />

          {groups.map((group) => (
            <Section key={group.urgency} style={groupSection}>
              <Section style={groupHeader}>
                <Text
                  style={{
                    ...groupLabel,
                    color: COLORS[group.urgency],
                  }}
                >
                  {group.label}
                </Text>
                <Text style={groupCount}>{group.emails.length}</Text>
              </Section>

              {group.emails.map((email, i) => (
                <Section key={i} style={item}>
                  <Text style={itemTitle}>
                    {email.ai_summary || "Action needed"}
                  </Text>
                  <Text style={itemMeta}>
                    {email.from}
                    <span style={dot}> · </span>
                    {email.ai_action || "Review"}
                    <span style={dot}> · </span>
                    {email.ageText}
                  </Text>
                </Section>
              ))}
            </Section>
          ))}

          {remainingCount != null && remainingCount > 0 && (
            <Section style={overflowSection}>
              <Text style={overflowText}>
                  +{remainingCount} more item{remainingCount > 1 ? "s" : ""} not
                shown
              </Text>
            </Section>
          )}

          <Hr style={divider} />

          <Section style={footer}>
            <Text style={footerText}>
              NeatMail &middot; Daily digest
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const body = {
  backgroundColor: "#f5f5f4",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  padding: "24px 0",
  margin: "0",
};

const container = {
  backgroundColor: "#ffffff",
  borderRadius: "8px",
  maxWidth: "520px",
  margin: "0 auto",
  padding: "32px 24px",
  border: "1px solid #e7e5e4",
};

const header = {
  marginBottom: "20px",
};

const heading = {
  fontSize: "20px",
  fontWeight: 700,
  color: "#1c1917",
  margin: "0 0 4px",
  lineHeight: 1.3,
};

const date = {
  fontSize: "13px",
  color: "#78716c",
  margin: "0",
};

const divider = {
  borderTop: "1px solid #e7e5e4",
  margin: "20px 0",
};

const groupSection = {
  marginBottom: "20px",
};

const groupHeader = {
  marginBottom: "8px",
};

const groupLabel = {
  fontSize: "12px",
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.5px",
  margin: "0",
  display: "inline",
};

const groupCount = {
  fontSize: "12px",
  color: "#a8a29e",
  margin: "0 0 0 6px",
  display: "inline",
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
};

const item = {
  padding: "12px 0",
  borderBottom: "1px solid #f5f5f4",
};

const itemTitle = {
  fontSize: "14px",
  fontWeight: 600,
  color: "#1c1917",
  margin: "0 0 2px",
  lineHeight: 1.4,
};

const itemMeta = {
  fontSize: "12px",
  color: "#78716c",
  margin: "0",
  lineHeight: 1.4,
};

const dot = {
  color: "#d6d3d1",
};

const overflowSection = {
  textAlign: "center" as const,
  marginBottom: "16px",
};

const overflowText = {
  fontSize: "13px",
  color: "#78716c",
  margin: "0",
};

const footer = {
  textAlign: "center" as const,
};

const footerText = {
  fontSize: "12px",
  color: "#a8a29e",
  margin: "0",
};
