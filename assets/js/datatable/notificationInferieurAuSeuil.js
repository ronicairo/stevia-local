window.addEventListener('DOMContentLoaded', function () {
    const table = $('#notif-inf-seuil-dataTable').DataTable({
        dom: 'lt<"bottom d-flex justify-content-between align-items-center"i p>B',
        ajax: {
            url: Routing.generate('notification_sold_lower'),
            data: function (d) {
                d.filters = getFilters('notif-inf-seuil-dataTable')
                return d;
            }
        },
        pageLength: 25,
        columns: [
            {
                "data": "numeroReference",
                "name": "numeroReference",
                "visible": true,
                "render": function (data) {
                    const url = Routing.generate('creance_reference', {id: data});
                    return '<a href="' + url + '">' + data + '</a>';
                }
            },
            {
                "data": "numeroDebiteur",
                "name": "numeroDebiteur",
            },
            {
                "data": "catDebiteur",
                "name": "catDebiteur"
            },
            {
                "data": "natureCompte",
                "name": "natureCompte"
            },
            {
                "data": "montantInitial",
                "name": "montantInitial",
                className: 'dt-body-right'
            },
            {
                "data": "solde",
                "name": "solde",
                className: 'dt-body-right'
            },
            {
                "data": "numUgeGestion",
                "name": "numUgeGestion"
            },
            {
                "data": "commentaireCreance",
                "name": "commentaireCreance"
            },
            {
                "data": "dateDetection",
                "name": "dateDetection", "visible": true},
            {
                "data": "delai",
                "name": "delai",
                className: 'dt-body-right',
                render: function (data) {
                    // Formate le nombre avec un espace comme séparateur de milliers
                    const formattedData = parseInt(data).toLocaleString();
                    return `${formattedData} jours`;
                }
            },
            {
                "data": "numUgeDetect",
                "name": "numUgeDetect"
            }
        ],
        buttons: [
            {
                text: 'Sélectionner toutes les lignes de la page',
                action: function () {
                    let rows = table.rows({ page: 'current' }).nodes();
                    let allSelected = true;

                    // Vérifie si toutes les lignes sont sélectionnées
                    $(rows).each(function () {
                        if (!$(this).hasClass('selected')) {
                            allSelected = false;
                            return false; // Sort de la boucle si une ligne n'est pas sélectionnée
                        }
                    });

                    // Bascule la sélection
                    $(rows).each(function () {
                        if (allSelected) {
                            $(this).removeClass('selected'); // Désélectionne si toutes les lignes sont sélectionnées
                        } else {
                            $(this).addClass('selected'); // Sélectionne si toutes les lignes ne sont pas sélectionnées
                        }
                    });

                    // Met à jour le texte du bouton
                    this.text(allSelected ? 'Sélectionner toutes les lignes de la page' : 'Désélectionner toutes les lignes de la page');
                }
            },
            {
                text: 'Supprimer les lignes sélectionnées',
                className: 'btn btn-danger',
                action: function () {
                    let selectedRows = table.rows('.selected').data().toArray();
                    let selectedIds = selectedRows.map(row => row.id);

                    // Vérifie si on a bien sélectionné des lignes
                    if (selectedIds.length > 0) {
                        const count = selectedIds.length === 1
                            ? 'la ligne sélectionnée'
                            : `les ${selectedIds.length} lignes sélectionnées`;
                        confirm(`Êtes-vous sûr de vouloir supprimer ${count} ?`)
                            .then(response => {
                            if (response) {
                                selectedIds.forEach(function (id) {
                                    $.ajax({
                                        url: Routing.generate('remove_echeance', {id: id}),
                                        type: 'POST',
                                        dataType: 'json',
                                        success: function () {
                                            console.log('Suppression réussie pour ID:', id);
                                        },
                                        error: function (xhr, status, error) {
                                            console.error("Erreur lors de la suppression de l'ID", id, ":", error);
                                        }
                                    });
                                });

                                // Recharge le tableau après la suppression
                                table.ajax.reload();
                            } else {
                                console.log("Suppression annulée.");
                            }
                        });
                    } else {
                        alert("Veuillez sélectionner des lignes à supprimer.");
                        $('#flashMessage')
                    }
                }
            }
        ],

        initComplete: function () {
            const processingDiv = $('.dt-processing');
            $('#custom-container').append(processingDiv);
        },
        rowCallback: function (row) {
            $(row).off('click').on('click', function () {
                $(this).toggleClass('selected');
            });
        },
    });

    initializeClickableDebiteur(table)
    initializeButtons(table);
    initializeFilters(table);
    rememberDataTable(table)
});