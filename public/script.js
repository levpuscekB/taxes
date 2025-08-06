/*
 * Client‑side logic for the salary tax distribution tool.
 *
 * This script attaches event listeners to the form, sends a
 * request to the back‑end server to compute the tax distribution
 * and populates the result section with a table and a chart.  It
 * also displays additional diagnostic information such as the
 * withheld amount and total contributions.
 */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('salaryForm');
  const resultsSection = document.getElementById('resultsSection');
  const breakdownTable = document.getElementById('breakdownTable');
  const chartCanvas = document.getElementById('chartCanvas');
  let chartInstance = null;

  // Create a helper to format currency values with two decimal
  // places and thousands separators.
  function formatEuro(value) {
    return value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    // Extract the values from inputs.  Convert to numbers to ensure
    // we pass correct query parameters.  If the user leaves
    // employerCost empty, treat it as NaN.
    const grossSalaryInput = document.getElementById('grossSalary');
    const netSalaryInput = document.getElementById('netSalary');
    const employerCostInput = document.getElementById('employerCost');
    const gross = parseFloat(grossSalaryInput.value);
    const net = parseFloat(netSalaryInput.value);
    const employerCost = employerCostInput.value ? parseFloat(employerCostInput.value) : NaN;
    if (isNaN(gross) || isNaN(net)) {
      alert('Please enter valid numeric values for gross and net salary.');
      return;
    }
    try {
      const query = new URLSearchParams({ grossSalary: gross, netSalary: net }).toString();
      const response = await fetch(`/calculate?${query}`);
      const data = await response.json();
      if (data.error) {
        alert(data.error);
        return;
      }
      // Clear previous table rows.
      breakdownTable.innerHTML = '';
      // Build rows for each category.
      data.breakdown.forEach((item) => {
        const tr = document.createElement('tr');
        const nameTd = document.createElement('td');
        nameTd.textContent = item.name;
        const valueTd = document.createElement('td');
        valueTd.textContent = formatEuro(item.amount);
        tr.appendChild(nameTd);
        tr.appendChild(valueTd);
        breakdownTable.appendChild(tr);
      });
      // Compute extra diagnostics.
      const withheld = data.withheld;
      const personalTax = data.personalIncomeTax;
      const employeeContrib = data.employeeContributions;
      const employerContrib = data.employerContributions;
      let employerDiff = NaN;
      if (!isNaN(employerCost)) {
        employerDiff = employerCost - gross;
      }
      // Append diagnostics as a separate summary row group.
      // Create a separator row.
      const separator = document.createElement('tr');
      separator.classList.add('separator');
      const sepCell = document.createElement('td');
      sepCell.setAttribute('colspan', '2');
      sepCell.style.paddingTop = '0.8rem';
      sepCell.style.borderBottom = 'none';
      separator.appendChild(sepCell);
      breakdownTable.appendChild(separator);
      // Add diagnostic rows.
      function addDiagnosticRow(label, value) {
        const tr = document.createElement('tr');
        const labelTd = document.createElement('td');
        labelTd.textContent = label;
        const valueTd = document.createElement('td');
        valueTd.textContent = formatEuro(value);
        valueTd.style.fontStyle = 'italic';
        tr.appendChild(labelTd);
        tr.appendChild(valueTd);
        breakdownTable.appendChild(tr);
      }
      addDiagnosticRow('Total withheld (gross - net)', withheld);
      addDiagnosticRow('Estimated personal income tax', personalTax);
      addDiagnosticRow('Employee contributions', employeeContrib);
      addDiagnosticRow('Employer contributions', employerContrib);
      if (!isNaN(employerDiff)) {
        addDiagnosticRow('Employer cost difference (cost - gross)', employerDiff);
      }
      // Show results section if hidden.
      resultsSection.classList.remove('hidden');
      // Prepare chart data.  Use category names and amounts from breakdown.
      const labels = data.breakdown.map((item) => item.name);
      const values = data.breakdown.map((item) => item.amount);
      // Create or update the chart.  Use a doughnut chart to visualise relative
      // shares.  Destroy existing chart instance first.
      if (chartInstance) {
        chartInstance.destroy();
      }
      chartInstance = new Chart(chartCanvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: labels,
          datasets: [
            {
              data: values,
              backgroundColor: [
                '#3366cc', '#dc3912', '#ff9900', '#109618', '#990099',
                '#0099c6', '#dd4477', '#66aa00', '#b82e2e', '#316395',
                '#994499', '#22aa99', '#aaaa11'
              ],
              borderWidth: 1
            }
          ]
        },
        options: {
          responsive: true,
          // maintain the aspect ratio of the chart.  When set to true
          // (default), Chart.js will calculate the height based on
          // the canvas width.  A fixed height is already set via CSS.
          maintainAspectRatio: true,
          plugins: {
            legend: {
              position: 'right',
              labels: {
                boxWidth: 12,
                padding: 8
              }
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const label = context.label || '';
                  const value = context.raw;
                  return `${label}: €${formatEuro(value)}`;
                }
              }
            }
          }
        }
      });
    } catch (err) {
      console.error(err);
      alert('An error occurred while calculating the distribution.');
    }
  });
});