window.addEventListener('DOMContentLoaded', function () {
    const creanceRegroupeeId = document.getElementById('id_creance_regroupee').value ?? 'noId';
    const userIsAdminOrRecouv = document.getElementById('role_admin_or_recouv').value === '1';
    const numCreance = document.getElementById('num_creance').value ?? 'noCreance';

    $('#detail-regroupement-dataTable').DataTable({
        ajax: Routing.generate('detail_regroupement_get_data', { creanceRegroupeeId: creanceRegroupeeId }),
        columns: [
            {
                'data': 'numeroCreance',
                'name': 'c.numeroCreance',
                'render': function (data) {
                    return '<div class="w-100 cursor-pointer openTab" data-numcreance="' + data + '"><a href="#openTab-' + data + '">' + data + '</a></div>';
                }
            },
            {
                'data': 'montantInitial',
                'name': 'c.montantInitial'
            },
            {
                'data': 'natureDerOpe',
                'name': 'c.natureDerOpe'
            },
            {
                'data': 'dateDerOpe',
                'name': 'dateDerOpe',
                'render': function (data) {
                    if (!data) return "";
                    let [jour, mois, annee] = data.split('/');
                    let date = new Date(annee, mois - 1, jour);
                    return date.toLocaleDateString("fr-FR");
                }
            },
            {
                'data': 'solde',
                'name': 'c.solde'
            },
            {
                'data': 'numTechnicien',
                'name': 'c.numTechnicien'
            },
            {
                'data': 'commentaireCreance',
                'name': 'c.commentaireCreance'
            },
            {
                'data': 'id',
                'name': 'c.id',
                'render': function (data) {
                    if (userIsAdminOrRecouv && data !== document.getElementById('num_reference').value) {
                        return "<btn data-numcreance='" + data + "' class='btn btn-danger text-white btn-detacher-creance w-100'>Détacher</btn>"
                    } else {
                        return '';
                    }
                }
            }
        ],
        initComplete: function () {
            // Déplace le message dans un autre conteneur
            const processingDiv = $('.dt-processing');
            $('#custom-container').append(processingDiv);

            if (userIsAdminOrRecouv) {
                let btnDetacheCreance = document.querySelectorAll('.btn-detacher-creance');

                btnDetacheCreance.forEach(btn => {
                    btn.addEventListener('click', () => {
                        confirm("Confirmez-vous le détachement de la créance " + btn.dataset.numcreance + " de ce regroupement ? Cliquer sur OK pour confirmer !")
                            .then(response => {
                                if (response) {
                                    location.href = Routing.generate('detachement_creance', {
                                        numcreance: btn.dataset.numcreance,
                                        creanceprev: document.getElementById('id_creance').value
                                    });
                                }
                            });
                    })
                })
            }

            let btnOpenTabs = document.querySelectorAll('.openTab');

            btnOpenTabs.forEach(btn => {
                btn.addEventListener('click', () => openTab(btn.dataset.numcreance));

                if (btn.dataset.numcreance === numCreance) {
                    openTab(btn.dataset.numcreance);
                }
            })
        }
    })
});

/**
 * Open creance information tab
 * @param numCreance
 */
function openTab(numCreance)
{
    let openTabElement = document.getElementById('openTab-' + numCreance);
    openTabElement.click();
    generateMouvementsDatatable(numCreance);
    const wrapperNavCreances = document.querySelector(".wrapper-onglets")
    wrapperNavCreances.scrollBy({ behavior: "smooth", left: openTabElement.offsetLeft})
}