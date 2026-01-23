/**
 * USPTO API response fixtures for testing
 */

// Successful JSON response for serial number lookup
export const serialNumberJsonResponse = {
  transactionTypeCd: "QRY",
  version: "2.6",
  transactionDate: "2025-01-22",
  trademarks: [
    {
      status: {
        serialNumber: "78462704",
        markElement: "APPLE",
        statusCode: 800,
        statusDate: "2024-06-15",
        statusDescriptionText: "REGISTERED AND RENEWED",
      },
      filing: {
        filingDate: "2004-06-18",
        drawingCode: "3000",
        publishDate: "2005-03-22",
      },
      registration: {
        registrationNumber: "3068631",
        registrationDate: "2006-03-14",
        renewalDate: "2016-03-14",
      },
      owner: {
        ownerName: "Apple Inc.",
        ownerAddress: "One Apple Park Way, Cupertino, California 95014",
        entityType: "Corporation",
        citizenshipState: "California",
        citizenshipCountry: "United States",
      },
      attorney: {
        attorneyName: "USPTO ATTORNEY",
        attorneyDocketNumber: "APPLE-001",
      },
      classification: {
        primaryInternationalClassCode: "009",
        usClassCodes: ["021", "023", "026", "036", "038"],
      },
    },
  ],
}

// Successful XML response for serial number lookup
export const serialNumberXmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<transaction xmlns="http://www.wipo.int/standards/XMLSchema/trademarks" transactionCode="QRY">
  <transactionHeader>
    <senderDetails>
      <senderIdentifier>USPTO</senderIdentifier>
    </senderDetails>
  </transactionHeader>
  <transactionBody>
    <transactionContentDetails>
      <trademarkDetails>
        <trademark operationCode="Query">
          <trademarkIdentifier>
            <applicationNumber>78462704</applicationNumber>
            <registrationNumber>3068631</registrationNumber>
          </trademarkIdentifier>
          <markRepresentation>
            <markFeatureCategory>Word</markFeatureCategory>
            <markVerbalElementText>APPLE</markVerbalElementText>
          </markRepresentation>
          <applicationDate>2004-06-18</applicationDate>
          <registrationDate>2006-03-14</registrationDate>
          <applicationStatus>
            <statusCode>800</statusCode>
            <statusText>REGISTERED AND RENEWED</statusText>
          </applicationStatus>
          <applicantDetails>
            <applicant>
              <applicantName>Apple Inc.</applicantName>
              <applicantAddressBook>
                <formattedAddress>One Apple Park Way, Cupertino, California 95014</formattedAddress>
              </applicantAddressBook>
            </applicant>
          </applicantDetails>
        </trademark>
      </trademarkDetails>
    </transactionContentDetails>
  </transactionBody>
</transaction>`

// Successful JSON response for registration number lookup
export const registrationNumberJsonResponse = {
  transactionTypeCd: "QRY",
  version: "2.6",
  transactionDate: "2025-01-22",
  trademarks: [
    {
      status: {
        serialNumber: "72016902",
        markElement: "NIKE SWOOSH",
        statusCode: 800,
        statusDate: "2023-09-01",
        statusDescriptionText: "REGISTERED AND RENEWED",
      },
      filing: {
        filingDate: "1971-05-07",
        drawingCode: "1000",
        publishDate: "1972-04-04",
      },
      registration: {
        registrationNumber: "0978952",
        registrationDate: "1974-01-22",
        renewalDate: "2024-01-22",
      },
      owner: {
        ownerName: "Nike, Inc.",
        ownerAddress: "One Bowerman Drive, Beaverton, Oregon 97005",
        entityType: "Corporation",
        citizenshipState: "Oregon",
        citizenshipCountry: "United States",
      },
    },
  ],
}

// HTML response for status endpoint
export const statusHtmlResponse = `<!DOCTYPE html>
<html>
<head>
  <title>Trademark Status: APPLE (78462704)</title>
  <meta charset="UTF-8">
</head>
<body>
  <h1>Trademark Case Status</h1>
  <div class="case-info">
    <p><strong>Serial Number:</strong> 78462704</p>
    <p><strong>Mark:</strong> APPLE</p>
    <p><strong>Status:</strong> REGISTERED AND RENEWED</p>
    <p><strong>Owner:</strong> Apple Inc.</p>
    <p><strong>Filing Date:</strong> June 18, 2004</p>
    <p><strong>Registration Date:</strong> March 14, 2006</p>
  </div>
</body>
</html>`

// Error responses
export const apiKeyMissingErrorResponse = `<!DOCTYPE html>
<html>
<head><title>401 Unauthorized</title></head>
<body>
<h1>Unauthorized</h1>
<p>You need to register for an API key to access this service.</p>
<p>Visit <a href="https://developer.uspto.gov">https://developer.uspto.gov</a> to register.</p>
</body>
</html>`

export const notFoundErrorResponse = `<!DOCTYPE html>
<html>
<head><title>404 Not Found</title></head>
<body>
<h1>Not Found</h1>
<p>The requested trademark record was not found.</p>
</body>
</html>`

export const rateLimitErrorResponse = {
  error: "Rate limit exceeded",
  message: "Too many requests. Please wait and try again.",
  retryAfter: 60,
}

export const serverErrorResponse = {
  error: "Internal Server Error",
  message: "An unexpected error occurred while processing your request.",
  statusCode: 500,
}

// Response for trademark not found (valid format, no results)
export const noResultsJsonResponse = {
  transactionTypeCd: "QRY",
  version: "2.6",
  transactionDate: "2025-01-22",
  trademarks: [],
}

// Response with multiple trademarks
export const multipleResultsJsonResponse = {
  transactionTypeCd: "QRY",
  version: "2.6",
  transactionDate: "2025-01-22",
  trademarks: [
    {
      status: {
        serialNumber: "97123456",
        markElement: "SAMPLE MARK A",
        statusCode: 630,
        statusDate: "2024-01-15",
        statusDescriptionText: "LIVE - APPLICATION FILING",
      },
    },
    {
      status: {
        serialNumber: "97123457",
        markElement: "SAMPLE MARK B",
        statusCode: 800,
        statusDate: "2024-02-20",
        statusDescriptionText: "REGISTERED",
      },
    },
  ],
}
