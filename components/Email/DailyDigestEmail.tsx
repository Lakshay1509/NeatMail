import {
  Html,
  Body,
  Container,
  Head,
  Heading,
  Text,
  Section,
  Button,
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
  dashboardUrl?: string;
}

const URGENCY_STYLES = {
  urgent: {
    color: "#C45B4A",
    bg: "#FDF6F5",
    border: "#C45B4A",
    label: "Critical",
  },
  needs_reply: {
    color: "#B8860B",
    bg: "#FDFAF5",
    border: "#B8860B",
    label: "Attention",
  },
  new_today: {
    color: "#6B9080",
    bg: "#F5F9F7",
    border: "#6B9080",
    label: "New",
  },
};

export default function DailyDigestEmail({
  totalEmails,
  dateLabel,
  groups,
  dashboardUrl = "https://dashboard.neatmail.app",
}: DailyDigestEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        {String(totalEmails)} email{totalEmails > 1 ? "s" : ""} need your
        attention — {dateLabel}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          {/* Masthead */}
          <Section style={header}>
            <Text style={brand}>NEATMAIL INTELLIGENCE BRIEFING</Text>
            <Text style={edition}>{dateLabel}</Text>
          </Section>

          {/* Hero */}
          <Section style={heroSection}>
            <Heading style={heroNumber}>
              {String(totalEmails)}
            </Heading>
            <Text style={heroLabel}>
              item{totalEmails > 1 ? "s" : ""} need your attention
            </Text>
          </Section>

          <Hr style={divider} />

          {/* Groups */}
          {groups.map((group) => {
            const style = URGENCY_STYLES[group.urgency];
            return (
              <Section key={group.urgency} style={groupSection}>
                <Section style={groupHeader}>
                  <div
                    style={{
                      ...groupLabelIndicator,
                      backgroundColor: style.color,
                    }}
                  />
                  <Text style={{ ...groupLabelText, color: style.color }}>
                    {group.label}
                  </Text>
                  <Text style={groupCount}>{group.emails.length}</Text>
                </Section>

                {group.emails.map((email, i) => (
                  <Section
                    key={i}
                    style={{
                      ...card,
                      backgroundColor: style.bg,
                      borderLeft: `3px solid ${style.border}`,
                    }}
                  >
                    <Text style={cardTitle}>
                      {email.ai_summary || "Action needed"}
                    </Text>
                    <Text style={cardMeta}>
                      {email.from}
                      <span style={metaDot}> · </span>
                      {email.ai_action || "Review"}
                      <span style={metaDot}> · </span>
                      {email.ageText}
                    </Text>
                  </Section>
                ))}
              </Section>
            );
          })}

          {/* CTA */}
          <Section style={ctaSection}>
            <Button style={button} href={dashboardUrl}>
              Open Dashboard
            </Button>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerBrand}>Powered by NeatMail AI</Text>
            <Text style={footerText}>
              You received this because you enabled daily digests in your
              NeatMail settings.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/* Light mode (default) styles */
const body = {
  backgroundColor: "#fafaf8",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  padding: "24px 0",
  margin: "0",
};

const container = {
  backgroundColor: "#ffffff",
  borderRadius: "16px",
  maxWidth: "540px",
  margin: "0 auto",
  padding: "36px 28px",
  border: "1px solid rgba(0,0,0,0.06)",
};

const header = {
  marginBottom: "28px",
  textAlign: "center" as const,
};

const brand = {
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "1.5px",
  textTransform: "uppercase" as const,
  color: "#a0a0a0",
  margin: "0 0 6px",
};

const edition = {
  fontSize: "14px",
  color: "#6b6b6b",
  margin: "0",
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
};

const heroSection = {
  textAlign: "center" as const,
  marginBottom: "28px",
};

const heroNumber = {
  fontSize: "48px",
  fontWeight: 700,
  color: "#1a1a1a",
  margin: "0 0 4px",
  lineHeight: 1.1,
  fontFamily: "'Helvetica Neue', Arial, sans-serif",
};

const heroLabel = {
  fontSize: "15px",
  color: "#6b6b6b",
  margin: "0",
  fontWeight: 400,
};

const divider = {
  borderTop: "1px solid rgba(0,0,0,0.06)",
  margin: "24px 0",
};

const groupSection = {
  marginBottom: "24px",
};

const groupHeader = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginBottom: "10px",
};

const groupLabelIndicator = {
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  display: "inline-block",
  flexShrink: 0,
};

const groupLabelText = {
  fontSize: "12px",
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.5px",
  margin: "0",
  display: "inline",
};

const groupCount = {
  fontSize: "12px",
  color: "#a0a0a0",
  margin: "0",
  display: "inline",
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
};

const card = {
  borderRadius: "10px",
  padding: "14px 16px",
  marginBottom: "8px",
};

const cardTitle = {
  fontSize: "14px",
  fontWeight: 600,
  color: "#1a1a1a",
  margin: "0 0 4px",
  lineHeight: 1.4,
};

const cardMeta = {
  fontSize: "12px",
  color: "#6b6b6b",
  margin: "0",
  lineHeight: 1.4,
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
};

const metaDot = {
  color: "#a0a0a0",
};

const ctaSection = {
  marginTop: "8px",
  textAlign: "center" as const,
};

const button = {
  backgroundColor: "#1a1a1a",
  color: "#ffffff",
  borderRadius: "8px",
  padding: "12px 24px",
  fontSize: "14px",
  fontWeight: 500,
  textDecoration: "none",
  display: "inline-block",
};

const footerSection = {
  textAlign: "center" as const,
};

const footerBrand = {
  fontSize: "11px",
  fontWeight: 600,
  letterSpacing: "1px",
  textTransform: "uppercase" as const,
  color: "#a0a0a0",
  margin: "0 0 6px",
};

const footerText = {
  fontSize: "12px",
  color: "#a0a0a0",
  margin: "0",
  lineHeight: 1.5,
};
