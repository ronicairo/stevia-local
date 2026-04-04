let cpt_row_depens_tex = 0;

afficherDepens();

/**
 * Evenement CLICK pour ajouter une ligne au tableau Dépens
 */
let btnAjouterDepens = document.getElementById('btn_ajouter_depens');
if (btnAjouterDepens != null) {
    document.getElementById('btn_ajouter_depens').addEventListener('click', function() {
        const tableRows = document.getElementById('table_depens').rows;
        let addNewRow = true;

        // Si on a au moins 3 lignes (ligne "entêtes", ligne "inputs", ligne "total")
        if (tableRows.length >= 3) {
            let rowIsEmpty = true;

            // On regarde l'avant-dernière ligne car la dernière ligne est celle du total
            for (let input of document.getElementsByClassName('input_' + tableRows[tableRows.length - 2].id)) {
                if (input.value !== '') {
                    rowIsEmpty = false;
                }
            }

            if (rowIsEmpty) {
                addNewRow = false;
            }
        }

        if (addNewRow) {
            ajouterRow('', '', '', '', '');
        }
    });
}

/**
 * Affiche le tableau Dépens
 */
function afficherDepens() {
    let ctxIdInput = document.getElementById('contentieux_id');
    if (ctxIdInput != null) {
        const id_ctx = ctxIdInput.value;

        if (id_ctx) {
            $.ajax({
                type: "POST",
                url: Routing.generate('contentieux_depens'),
                data: {
                    id_ctx: id_ctx
                },
                success: function (jsonresult) {
                    remplirRow(jsonresult);
                },
                error: function (XMLHttpRequest, textStatus, errorThrown) {
                    alert('Error : ' + errorThrown);
                }
            });
        }
    }
}

/**
 * Remplie le tableau des Dépens
 *
 * @param jsonresult
 */
function remplirRow(jsonresult)
{
    const datas = JSON.parse(jsonresult);

   datas.forEach((element) => {
       ajouterRow(
           element.fraishuissier,
           element.montant,
           element.odp,
           element.reference,
           element.id,
           element.contentieuxid
       );
   })

    recalculTotalDepens();
}

/**
 * Ajoute une row au tableau Dépens
 *
 * @param fraishuissier
 * @param montant
 * @param odp
 * @param reference
 * @param id
 */
function ajouterRow(fraishuissier, montant, odp, reference, id)
{
    cpt_row_depens_tex++;
    let totalRow = document.getElementById('table_depens_row_total');
    let creanceRegId = document.getElementById('id_creance_regroupee');

    let newTr = document.createElement("tr");
    let newTrId = 'tr_depens_' + cpt_row_depens_tex;
    newTr.id = newTrId;

    for (let i = 0;i < 7;i++) {
        let newTd = document.createElement('td');
        let newInput = document.createElement('input');

        newInput.type = 'text';
        newInput.className = 'form-control input_tr_depens_' + cpt_row_depens_tex

        switch (i) {
            case 0:
                newInput.type = 'hidden';
                newInput.name = `contentieux[depens_tex][${cpt_row_depens_tex}][id]`;
                newInput.value = id;
                break;
            case 1:
                newInput.name = `contentieux[depens_tex][${cpt_row_depens_tex}][fh]`;
                newInput.value = fraishuissier;
                break;
            case 2:
                newInput.name = `contentieux[depens_tex][${cpt_row_depens_tex}][mnt]`;
                newInput.value = montant;
                newInput.id = 'input_tex_montant_' + cpt_row_depens_tex;
                newInput.className = newInput.className + ' input_depens_montant';
                break;
            case 3:
                newInput.name = `contentieux[depens_tex][${cpt_row_depens_tex}][odp]`;
                newInput.maxLength = 10;
                newInput.value = odp;
                break;
            case 4:
                newInput.name = `contentieux[depens_tex][${cpt_row_depens_tex}][refd]`;
                newInput.value = reference;
                newInput.id = 'input_tex_refd_' + cpt_row_depens_tex;
                break;
            case 6:
                newInput.type = 'hidden';
                newInput.name = 'contentieux[creanceregroupeeid]';
                newInput.value = creanceRegId.value;
                break;
            case 5:
                const index = cpt_row_depens_tex;
                newInput = document.createElement('a');
                newInput.className = 'btn btn-danger text-white w-100';
                newInput.innerHTML = '<i class="bi-trash"></i> Supprimer';
                newInput.setAttribute('target', newTrId)
                newInput.addEventListener('click', (event) => supprimeRow(id, event, index));
                break;
        }

        newTd.appendChild(newInput);
        newTr.appendChild(newTd);
    }

    totalRow.before(newTr);

    // on récupère la derniere ligne
    let lastRow = document.getElementById('input_tex_montant_' + cpt_row_depens_tex);
    $(lastRow).maskMoney({
        autoUnmask: true,
        suffix: ' €',
        decimal: ',',
        precision: 2,
        thousands: ' ',
        allowZero: false,
        allowNegative: false,
        showSymbol: true,
        symbolStay: true,
        defaultZero: false
    });
    lastRow.addEventListener('keyup', recalculTotalDepens);
    if (montant !== "") {
        $(lastRow).maskMoney('mask');
    }

    $("#input_tex_refd_" + cpt_row_depens_tex).inputmask({
        mask: "9999999999",
        placeholder: ""
    });

    recalculTotalDepens();
}

/**
 * Supprime une ligne du tableau
 */
function supprimeRow(id, event, indexRow) {
    // Récupération de la ligne (row) en fonction de l'attribut 'target'
    let row = document.getElementById(event.target.getAttribute('target'));

    if (!row) {
        console.error('Ligne introuvable');
        return;
    }

    // Récupération de l'input avec le nom contenant l'index de la ligne
    let inputId = row.querySelector(`input[name="contentieux[depens_tex][${indexRow}][id]"]`);

    if (!inputId) {
        console.error('Input ID introuvable');
        return;
    }

    // Masquer la ligne visuellement
    row.classList.add('d-none');

    // Suppression des autres inputs (sauf ceux avec le nom contenant 'id')
    row.querySelectorAll(`input[name^="contentieux[depens_tex][${indexRow}]"]:not([name*="id"])`).forEach((input) => {
        input.remove();
    });

    // Recalcule les totaux (supposons que cette fonction existe déjà)
    recalculTotalDepens();

    // Si l'ID est vide, cela signifie que la ligne n'a pas été remplie, donc suppression complète
    if (id === "") {
        inputId.remove();
        return;
    }

    // Si l'ID n'est pas vide, on met à jour l'input pour marquer la ligne comme supprimée
    inputId.removeAttribute('name'); // Suppression de l'attribut name existant
    inputId.setAttribute('name', "contentieux[depens_tex_deleted][]"); // Nouveau nom pour le champ
    inputId.value = id; // On définit la valeur de l'input avec l'ID passé en paramètre
}
/**
 * Recalcule le total des Dépens
 */
function recalculTotalDepens()
{
    let total_depens = "";

    for (let input of document.getElementsByClassName('input_depens_montant')) {
        total_depens = +total_depens + +input.value.replace('€', '').replace(' ', '').replace(',', '.')
    }

    document.getElementById('cell_total_depens').innerHTML = number_format(total_depens, 2, ',', ' ') + ' €';
}

/**
 * Formate le nombre en paramètre
 *
 * @param number
 * @param decimals
 * @param decPoint
 * @param thousandsSep
 * @returns {string}
 */
function number_format(number, decimals, decPoint, thousandsSep)
{
    number = (number + '').replace(/[^0-9+\-Ee.]/g, '')
    let n = !isFinite(+number) ? 0 : +number
    let prec = !isFinite(+decimals) ? 0 : Math.abs(decimals)
    let sep = (typeof thousandsSep === 'undefined') ? ',' : thousandsSep
    let dec = (typeof decPoint === 'undefined') ? '.' : decPoint
    let toFixedFix = function (n, prec) {
        let k = Math.pow(10, prec)
        return '' + (Math.round(n * k) / k)
            .toFixed(prec)
    }

    let s = (prec ? toFixedFix(n, prec) : '' + Math.round(n)).split('.')
    if (s[0].length > 3) {
        s[0] = s[0].replace(/\B(?=(?:\d{3})+(?!\d))/g, sep)
    }
    if ((s[1] || '').length < prec) {
        s[1] = s[1] || ''
        s[1] += new Array(prec - s[1].length + 1).join('0')
    }
    return s.join(dec)
}