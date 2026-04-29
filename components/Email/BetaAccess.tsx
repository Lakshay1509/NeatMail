import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Text,
  Heading,
  Button,
  Hr,
  Link,
} from "@react-email/components";

interface BetaAccessEmailProps {
  activationLink: string;
}

export default function BetaAccessEmail({
  
  activationLink,
}: BetaAccessEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your NeatMail beta inbox is ready — activate in 2 minutes.</Preview>

      <Body style={main}>
        <Container style={container}>
          <Section>
            <Text style={paragraph}>Hey there,</Text>

            <Text style={paragraph}>
              Good news — your <strong>NeatMail beta access is now live.</strong>
            </Text>

            <Text style={paragraph}>
              You're one of the early users getting in before public launch, and
              I'd love to get your inbox set up today.
            </Text>

            <Heading as="h3" style={subheading}>
              What happens once you connect Gmail:
            </Heading>

            <Text style={bullet}>• Important emails get separated from low-value noise automatically</Text>
            <Text style={bullet}>• AI drafts replies for emails that actually need your attention</Text>
            <Text style={bullet}>• Follow-ups, meetings, bills, and action items stop slipping through</Text>
            <Text style={bullet}>• Most users save 30+ minutes every single day</Text>

            <Text style={paragraph}>
              This isn't another inbox client — it quietly works in the
              background so your email starts organizing itself.
            </Text>

            <Section style={buttonSection}>
              <Button href={activationLink} style={button}>
                Activate NeatMail Now
              </Button>
            </Section>

            <Text style={smallText}>
              Setup takes about 2 minutes. No credit card. No installation.
            </Text>

            <Hr style={hr} />

            <Heading as="h3" style={subheading}>
              Is connecting Gmail safe?
            </Heading>

            <Text style={paragraph}>
              Yes — NeatMail uses Google's official Gmail permission flow and
              only requests the access needed to organize, summarize, and draft
              emails on your behalf.
            </Text>

            <Text style={paragraph}>
              Google may temporarily show an <strong>“unverified app”</strong>{" "}
              notice while NeatMail completes final review.
            </Text>

            <Text style={paragraph}>
              You can safely continue by clicking:
              <br />
              <strong>Advanced → Go to NeatMail</strong>
            </Text>

            <Text style={smallText}>
              (Completely normal for early-stage Google-integrated apps.)
            </Text>

            <Hr style={hr} />

            <Heading as="h3" style={subheading}>
              Why I recommend doing this now
            </Heading>

            <Text style={paragraph}>
              Beta onboarding is hands-on right now, which means I'm personally
              monitoring every new inbox connection and helping users get the
              best results in their first day.
            </Text>

            <Text style={paragraph}>
              The sooner you connect, the sooner I can tune NeatMail around your
              inbox patterns.
            </Text>

            <Text style={paragraph}>
              If you hit any issue at all, just reply to this email — I
              personally answer every beta user.
            </Text>

            <Text style={signature}>
              Excited to get you onboard,
              <br />
              <br />
              Lakshay
              <br />
              Founder,{" "}
              <Link href="https://neatmail.app" style={link}>
                NeatMail
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: "#f8f8f8",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  padding: "30px 12px",
};

const container = {
  maxWidth: "560px",
  margin: "0 auto",
  backgroundColor: "#ffffff",
  padding: "40px 32px",
  borderRadius: "12px",
};

const paragraph = {
  fontSize: "15px",
  lineHeight: "26px",
  color: "#222222",
  margin: "0 0 18px",
};

const subheading = {
  fontSize: "16px",
  marginTop: "28px",
  marginBottom: "16px",
  color: "#111111",
};

const bullet = {
  fontSize: "15px",
  lineHeight: "24px",
  color: "#222222",
  margin: "0 0 8px",
};

const buttonSection = {
  textAlign: "center" as const,
  margin: "30px 0 14px",
};

const button = {
  backgroundColor: "#111111",
  color: "#ffffff",
  padding: "14px 28px",
  borderRadius: "8px",
  textDecoration: "none",
  fontSize: "14px",
  fontWeight: "600",
};

const smallText = {
  fontSize: "13px",
  color: "#666666",
  lineHeight: "22px",
  marginBottom: "18px",
};

const hr = {
  borderColor: "#eeeeee",
  margin: "28px 0",
};

const signature = {
  fontSize: "15px",
  lineHeight: "26px",
  color: "#222222",
  marginTop: "30px",
};

const link = {
  color: "#111111",
  textDecoration: "underline",
};