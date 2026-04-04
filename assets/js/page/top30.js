import Chart from "chart.js/auto";

document.addEventListener('DOMContentLoaded', function () {
    // recuperer toutes les données du resultat de la soumission du formulaire
    const data = $("#js-vars").data('result-top30').datas;

    // le type creance (cumul pou creance)
    const typeCreance = $("#js-vars").data('search')['choix_type_creance']

    let dataChart;
    let title;
    let stepSize;

    if (typeCreance === 'creances') {
        // Les données trier en fonction de nombre lorsque qu'il s'agit de nombre de créances
        dataChart = data.sort((a, b) => b.Nombre - a.Nombre);
        // Le titre du chart
        title = 'Nombre de créance'
        // graduation des axes des abscisses
        stepSize = 200

    } else {
        // Les données trier en fonction de montant total lorsque qu'il s'agit de cumul
        dataChart = data.sort((a, b) => b.Total - a.Total);
        title = 'Total des montants initiaux'
        stepSize = 1000000

    }

    new Chart(document.getElementById('top30-chart'), {
        type: 'bar',
        data: {
            labels: dataChart.map((x) => x['Debiteur']),
            datasets: [{
                label: title,
                data: dataChart.map((x) => typeCreance === 'creances' ? x['Nombre'] : x['Total']),
                backgroundColor: '#0094C9',
                barPercentage: 1,
                categoryPercentage: 0.6
            }]
        },
        options: {
            indexAxis: 'y',
            scales: {
                y: {
                    ticks: {
                        crossAlign: 'far',
                        autoSkip: false,
                        callback: function (value, index) {
                            // Affiche le label que pour les index pairs, sinon ''
                            return index % 2 === 0 ? this.getLabelForValue(value) : '';
                        }
                    }
                },
                x: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: stepSize
                    }
                },
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        // Le texte affiché au survol
                        label: function (context) {
                            // Récupère l'objet data complet correspondant
                            const item = dataChart[context.dataIndex];
                            return [
                                `Numéro débiteur : ${item.Numero}`,
                                `Nom : ${item.Nom}`,
                                `Nombre de créances : ${item.Nombre}`,
                                `Total Montant Initiaux : ${item.TotalDevice}`
                            ];
                        }
                    }
                },
                legend: {
                    position: 'bottom'
                },
            }
        },
    });

    /**
     * Export csv
     */
    const downloadCsv = () => {

        $.ajax({
            url: Routing.generate('supervision_top_30_debiteurs_export'),
            data: {
                search: $("#js-vars").data('search')
            },
            method: "GET",
            success: (response) => {
                const BOM = new Uint8Array([0xEF, 0xBB, 0xBF]);
                const link = document.createElement('a');
                link.href = window.URL.createObjectURL(
                    new Blob(
                        [BOM, response],
                        {type: 'text/csv'}
                    )
                );
                link.download = 'top30Debiteur.csv';
                link.click();
                window.URL.revokeObjectURL(link);
                showSpinner(false)
                this.processing(false);
            },
            error: function (request, status, error) {
                console.error('Une erreur s\'est produite lors du chargement :', status, error);
                alert('Une erreur est survenue lors de l\'export. Veuillez réessayer plus tard.');
                showSpinner(false)
            }
        })

    }
    /**
     * afficher ou chacher le spinner
     * @param show
     */
    const showSpinner = (show) => {
        document.getElementById('spinner').classList.toggle('d-none', !show)
    }
    document.getElementById('download-csv').addEventListener('click', () => {
        showSpinner(true)
        downloadCsv()
    });

})