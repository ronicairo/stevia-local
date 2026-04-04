window.addEventListener('DOMContentLoaded', function () {

    const numRefSuccess = document.getElementById('ref-integree-success')
    const alertSuccess = document.getElementById('alert-success')
    let timeoutId;

    const table = $('#remise-wf-dataTable').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('workflow_remise_get_data'),
            data: function (data) {
                data.filters = getFilters('remise-wf-dataTable');
                return data;
            }
        },
        columns: [
            {
                "name": "numeroReference",
                "render": function (data, type, row) {
                    const url = Routing.generate('creance_reference', {
                        'id': row.numeroReference,
                    })
                    return `<a href="${url}" title="Consulter">${row.numeroReference}</a>`
                }
            },
            {
                "name": "numeroDebiteur",
                "data": "numeroDebiteur",
                "className": "clickable-debiteur"
            },
            {"data": "catDebiteur", "name": "catDebiteur"},
            {"data": "montantInitial", "name": "montantInitial", className: 'dt-body-right'},
            {"data": "solde", "name": "solde", className: 'dt-body-right'},
            {"data": "workflow", "name": "workflow"},
            {"data": "etapeRemiseWf", "name": "etapeRemiseWf"},
            {
                "data": "remiseWF",
                "name": "remiseWF",
                "orderable": false,
                "render": function (data, type, row) {
                    const url = Routing.generate('creance_regroupee_retour_derniere_etape_wf', {
                        'id': row.id,
                        'etape': row.idEtapeRemiseWf,
                    })

                    return `<div class="text-center">
                                <a href="${url}" data-num-ref="${row.numeroReference}" title="Réintégrer la créance dans le workflow" role="button" class="btn-return-workflow">
                                    <i class="bi bi-sign-turn-left fs-3"></i>
                                </a>
                            </div>`
                }
            }
        ],
        buttons: [
            {
                extend: 'csv',
                text: 'Exporter en CSV',
                action: function () {
                    $.ajax({
                        url: Routing.generate('workflow_remise_export'),
                        data: JSON.stringify(
                            {filters: getFilters('remise-wf-dataTable')}
                        ),
                        method: "POST",
                        success: (response) => {
                            const BOM = new Uint8Array([0xEF,0xBB,0xBF]);
                            const link = document.createElement('a');
                            link.href = window.URL.createObjectURL(
                                new Blob(
                                    [BOM, response],
                                    {type: 'text/csv'}
                                )
                            );
                            link.download = 'remise_wf.csv';
                            link.click();
                            window.URL.revokeObjectURL(link);

                            this.processing(false);
                        },
                        error: function (request, status, error) {
                            console.error('Une erreur s\'est produite lors du chargement :', status, error);
                            alert('Une erreur est survenue lors de l\'export. Veuillez réessayer plus tard.');
                        }
                    });
                }
            }
        ],
        initComplete: () => {

        }
    })

    table.on('draw.dt', function () {
        const numsDeb = document.querySelectorAll('.num-debiteur')
        numsDeb.forEach((num) => {
            num.addEventListener('click', () => {
                const columnIndex = table.column(`numeroDebiteur:name`).index();
                const inputValue = document.querySelector(`input[id='numeroDebiteur']`);
                const operatorValue = document.querySelector(`select[id='numeroDebiteur_operator']`);
                const filterValue = num.getAttribute('data-num-deb'); // Récupérer la valeur du filtre

                filters['remise-wf-dataTable'] = {}

                filters['remise-wf-dataTable']['numeroDebiteur'] = {
                    value: filterValue,
                    operator: 'contains',
                    type: 'text'
                }

                localStorage.setItem('filters', JSON.stringify(filters))

                inputValue.value = filterValue
                operatorValue.value = 'contains'

                table
                    .column(columnIndex)
                    .search(filterValue.replace(/\s+/g, ""))
                    .draw();

            });
        })
    })

    const returnWf = (btns) => {
        if (!btns) return;
        btns.forEach((btn) => {
            btn.removeEventListener('click', handleReturnWf); // Éviter les doublons
            btn.addEventListener('click', handleReturnWf);
        });
    };

    const showAlertTemporarily = (alertElement, numRefElement, numRefCurrent) => {
        numRefElement.innerHTML = numRefCurrent;
        alertElement.classList.remove('d-none');

        clearTimeout(timeoutId); // Annule tout timeout précédent
        timeoutId = setTimeout(() => {
            alertElement.classList.add('d-none');
        }, 5000);
    };

    const handleReturnWf = function (event) {
        event.preventDefault();
        const numRefCurrent = this.getAttribute('data-num-ref')
        const ask = confirm(`Confirmez-vous la réintégration cette créance (N° de référence:<span class='fw-bold'>${numRefCurrent}</span>) dans le workflow ?`);

        ask.then(response => {
            if (!response) return;
            $.ajax({
                url: this.href,
                type: 'POST',
                success: function () {
                    showAlertTemporarily(alertSuccess, numRefSuccess, numRefCurrent);
                    table.ajax.reload();
                },
                error: function () {
                    showAlertTemporarily(alertSuccess, numRefSuccess, numRefCurrent);
                }
            });

        })
    };

    returnWf(document.querySelectorAll('.btn-return-workflow'));

    table.on('draw', function () {
        returnWf(document.querySelectorAll('.btn-return-workflow'));
    });

    initializeFilters(table)
    initializeButtons(table)
    rememberDataTable(table)
})
