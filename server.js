const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Serve static files from the public directory.  This simple server
// handles only GET requests and returns JSON output for the
// `/calculate` endpoint.  All other paths under `/` are served
// directly from the public folder based off of the requested
// pathname.

const publicDir = path.join(__dirname, 'public');

/**
 * Compute the distribution of taxes and contributions for a given
 * salary.  The calculation reflects Slovenian tax law and public
 * spending structure as of summer 2025.  See accompanying
 * documentation and research citations for details on the figures
 * used in this model.
 *
 * @param {number} netSalary  Net salary in euros (take‑home pay).
 * @param {number} grossSalary  Gross salary in euros (before
 *                              deductions).
 * @returns {object} An object containing the calculated
 *                   breakdown of amounts by category and some
 *                   intermediate values.
 */
function calculateDistribution(netSalary, grossSalary) {
  // Convert inputs to numbers and guard against invalid values.
  const net = Number(netSalary);
  const gross = Number(grossSalary);
  if (!Number.isFinite(net) || !Number.isFinite(gross) || gross <= 0) {
    return { error: 'Invalid salary values' };
  }

  // Social security contribution rates for employees and employers in
  // Slovenia, reflecting the situation in 2025.  Rates are expressed
  // as fractions of gross salary.  Source: PwC Worldwide Tax
  // Summaries and KPMG Flash Alerts【877746781011989†L372-L386】【597588980302648†L253-L268】.
  const rates = {
    pensionEmployee: 0.155,    // 15.50% employee pension & disability insurance
    pensionEmployer: 0.0885,   // 8.85% employer pension & disability insurance
    healthEmployee: 0.0636,    // 6.36% employee health insurance
    healthEmployer: 0.0656,    // 6.56% employer health insurance
    unemploymentEmployee: 0.0014, // 0.14% employee unemployment insurance
    unemploymentEmployer: 0.0006, // 0.06% employer unemployment insurance
    parentalEmployee: 0.0010,  // 0.10% employee parental insurance
    parentalEmployer: 0.0010,  // 0.10% employer parental insurance
    injuryEmployer: 0.0053,    // 0.53% employer accident at work insurance
    longTermCareEmployee: 0.01, // 1% employee long‑term care insurance (from July 2025)
    longTermCareEmployer: 0.01 // 1% employer long‑term care insurance (from July 2025)
  };
  // Flat compulsory health‑care contribution (introduced January 2024) in
  // euros per month【214281270121894†L175-L187】.
  const flatHealthContribution = 35;

  // Calculate the various contributions.
  const pensionContribution = gross * (rates.pensionEmployee + rates.pensionEmployer);
  // Health contributions include health insurance and long‑term care
  // contributions for both employee and employer plus the flat fee.
  const healthContribution = gross * (rates.healthEmployee + rates.healthEmployer +
                                      rates.longTermCareEmployee + rates.longTermCareEmployer) +
                             flatHealthContribution;
  // Unemployment insurance contributions.
  const unemploymentContribution = gross * (rates.unemploymentEmployee + rates.unemploymentEmployer);
  // Parental insurance contributions.
  const parentalContribution = gross * (rates.parentalEmployee + rates.parentalEmployer);
  // Injury at work contribution (employer only).
  const injuryContribution = gross * rates.injuryEmployer;

  // Total employee and employer contributions separately.  These are
  // useful for diagnostics but not directly reported.
  const totalEmployeeContrib = gross * (
    rates.pensionEmployee +
    rates.healthEmployee +
    rates.unemploymentEmployee +
    rates.parentalEmployee +
    rates.longTermCareEmployee
  ) + flatHealthContribution;
  const totalEmployerContrib = gross * (
    rates.pensionEmployer +
    rates.healthEmployer +
    rates.unemploymentEmployer +
    rates.parentalEmployer +
    rates.injuryEmployer +
    rates.longTermCareEmployer
  );

  // Amount withheld from the employee (gross minus net).  This
  // withheld amount includes employee social contributions, the
  // compulsory health‑care contribution and personal income tax.  We
  // approximate the personal income tax by removing employee
  // contributions (including the flat health contribution) from the
  // withheld amount.
  const withheld = gross - net;
  const estimatedEmployeeContrib = gross * (
    rates.pensionEmployee + rates.healthEmployee +
    rates.unemploymentEmployee + rates.parentalEmployee +
    rates.longTermCareEmployee
  ) + flatHealthContribution;
  let personalIncomeTax = withheld - estimatedEmployeeContrib;
  if (personalIncomeTax < 0) personalIncomeTax = 0;

  // Relative shares of general government expenditure by function in
  // 2023 (latest data).  These figures convert the expenditure by
  // function expressed as percentages of GDP【353180037861609†L176-L188】 into
  // proportions of total general government expenditure (46.5% of
  // GDP)【353180037861609†L176-L188】.
  const relativeGeneralShares = {
    socialProtection: 0.3655913978494624, // 17.0 / 46.5
    health: 0.15913978494623654,          // 7.4 / 46.5
    economicAffairs: 0.13548387096774192, // 6.3 / 46.5
    education: 0.11612903225806451,       // 5.4 / 46.5
    generalPublicServices: 0.0989247311827957, // 4.6 / 46.5
    publicOrderAndSafety: 0.034408602150537634, // 1.6 / 46.5 (police)
    recreationCultureReligion: 0.03225806451612903, // 1.5 / 46.5
    defence: 0.025806451612903226,         // 1.2 / 46.5 (army)
    environmentalProtection: 0.019354838709677417, // 0.9 / 46.5
    housingAndCommunity: 0.01075268817204301       // 0.5 / 46.5
  };
  // Social protection sub‑category distribution within social
  // protection expenditure (values derived from SURS 2023 data)【353180037861609†L217-L232】.
  const relativeSocialSubShares = {
    sicknessAndDisability: 0.05478982029930613,
    oldAge: 0.21217990101140521,
    survivors: 0.02414123774418658,
    familyChildren: 0.03907778567808973,
    unemployment: 0.006608495248408616,
    housing: 0.0007080530623294946,
    socialExclusion: 0.021477609557328,
    rAndD: 0.0000337168124918807,
    other: 0.006574778435916736
  };
  // Compute combined shares for our user‑friendly categories by
  // combining general government shares with social protection
  // break‑down where appropriate.  Pensions correspond to the old
  // age sub‑category within social protection.  Unemployment and
  // family support come from their respective sub‑categories.
  const sharePensions = relativeSocialSubShares.oldAge;
  const shareUnemployment = relativeSocialSubShares.unemployment;
  const shareFamily = relativeSocialSubShares.familyChildren;
  const shareOtherSocial = relativeSocialSubShares.survivors +
                           relativeSocialSubShares.socialExclusion +
                           relativeSocialSubShares.housing +
                           relativeSocialSubShares.rAndD +
                           relativeSocialSubShares.other;
  // Healthcare share includes direct health expenditure and the
  // sickness/disability part of social protection.
  const shareHealthcare = relativeGeneralShares.health + relativeSocialSubShares.sicknessAndDisability;

  // Allocate personal income tax to each category using these
  // relative shares.
  const allocated = {};
  allocated.pensions = personalIncomeTax * sharePensions;
  allocated.healthcare = personalIncomeTax * shareHealthcare;
  allocated.unemployment = personalIncomeTax * shareUnemployment;
  allocated.familySupport = personalIncomeTax * shareFamily;
  allocated.otherSocialProtection = personalIncomeTax * shareOtherSocial;
  allocated.education = personalIncomeTax * relativeGeneralShares.education;
  allocated.defence = personalIncomeTax * relativeGeneralShares.defence;
  allocated.police = personalIncomeTax * relativeGeneralShares.publicOrderAndSafety;
  allocated.economicAffairs = personalIncomeTax * relativeGeneralShares.economicAffairs;
  allocated.generalPublicServices = personalIncomeTax * relativeGeneralShares.generalPublicServices;
  allocated.culture = personalIncomeTax * relativeGeneralShares.recreationCultureReligion;
  allocated.environment = personalIncomeTax * relativeGeneralShares.environmentalProtection;
  allocated.housing = personalIncomeTax * relativeGeneralShares.housingAndCommunity;

  // Combine contributions with allocated personal income tax to form
  // the final amount per category.
  const finalBreakdown = [];
  finalBreakdown.push({ name: 'Pensions (old age)', amount: pensionContribution + allocated.pensions });
  finalBreakdown.push({ name: 'Healthcare & medical system', amount: healthContribution + allocated.healthcare + injuryContribution });
  finalBreakdown.push({ name: 'Unemployment insurance', amount: unemploymentContribution + allocated.unemployment });
  finalBreakdown.push({ name: 'Parental & family support', amount: parentalContribution + allocated.familySupport });
  finalBreakdown.push({ name: 'Other social protection', amount: allocated.otherSocialProtection });
  finalBreakdown.push({ name: 'Education (schools)', amount: allocated.education });
  finalBreakdown.push({ name: 'Defence (army)', amount: allocated.defence });
  finalBreakdown.push({ name: 'Police (public order & safety)', amount: allocated.police });
  finalBreakdown.push({ name: 'Economic affairs & subsidies', amount: allocated.economicAffairs });
  finalBreakdown.push({ name: 'General public services', amount: allocated.generalPublicServices });
  finalBreakdown.push({ name: 'Culture & recreation', amount: allocated.culture });
  finalBreakdown.push({ name: 'Environmental protection', amount: allocated.environment });
  finalBreakdown.push({ name: 'Housing & community amenities', amount: allocated.housing });

  // Compute totals for reporting.
  const totalAllocatedTax = Object.values(allocated).reduce((sum, v) => sum + v, 0);
  const totalContrib = pensionContribution + healthContribution + unemploymentContribution + parentalContribution + injuryContribution;
  const total = totalContrib + totalAllocatedTax;

  return {
    grossSalary: gross,
    netSalary: net,
    withheld: withheld,
    employeeContributions: totalEmployeeContrib,
    employerContributions: totalEmployerContrib,
    personalIncomeTax: personalIncomeTax,
    contributions: {
      pension: pensionContribution,
      health: healthContribution,
      unemployment: unemploymentContribution,
      parental: parentalContribution,
      injury: injuryContribution
    },
    allocations: allocated,
    breakdown: finalBreakdown,
    totalCollected: total
  };
}

// Create HTTP server.
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // API endpoint for calculation.
  if (pathname === '/calculate' && req.method === 'GET') {
    const query = parsedUrl.query;
    const net = parseFloat(query.netSalary);
    const gross = parseFloat(query.grossSalary);
    if (isNaN(net) || isNaN(gross)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or invalid parameters' }));
      return;
    }
    const result = calculateDistribution(net, gross);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // Serve static files.  For the root path, default to index.html.
  let filePath = path.join(publicDir, pathname);
  if (pathname === '/' || pathname === '') {
    filePath = path.join(publicDir, 'index.html');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    // Determine content type from file extension.
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.svg': 'image/svg+xml'
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// Start the server only if this module is run directly (not when
// imported).  The port defaults to 3000 but can be overridden via
// the PORT environment variable.
if (require.main === module) {
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}

module.exports = { calculateDistribution };