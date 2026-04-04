if (!String.prototype.startsWith) {
    String.prototype.startsWith = function (searchString, position) {
        position = position || 0;
        return this.substr(position, searchString.length) === searchString;
    };
}

function openEditor(environment, reference, filename, apiDocServer) {
    let contentPage = document.querySelector('section.content'),
        formContainer = document.createElement('div')

    formContainer.setAttribute('id', 'openEditor')
    formContainer.classList.add('d-none')
    formContainer.innerHTML = `<form action="${apiDocServer}" method="get" target="_blank" id="editorSucre">
                                <input type="text" name="reference" value="${reference}">
                                <input type="text" name="environment" value="${environment}">
                                <input type="text" name="mode" value="edit">
                                <input type="text" name="filename" value="${filename}">
                                <input type="submit">
                            </form>`

    contentPage.appendChild(formContainer)
    document.querySelector('#editorSucre').submit()
}

/**
 *
 * @param {json} result
 * @param {Boolean} showwarnings
 * @returns {Boolean}
 *
 */
function analyseResultatPapyrus(result, showwarnings) {
    let datas, onerror = false, msg;
    try {
        if (typeof (result) === 'string') {
            datas = JSON.parse(result)
        } else {
            datas = result;
        }
    } catch (e) {
        alert('Erreur lors du parsing json : ' + e);
        alert(JSON.stringify(result));
        return false;
    }
    if (typeof datas['erreurs'] !== "undefined" && datas['erreurs'].length > 0) {
        msg = 'Le courrier n\'a pas été généré à cause des erreurs suivantes:\n\n';
        datas['erreurs'].forEach(function (entry) {

            msg = msg + '   -> ' + entry.replace('&lt;', '\74').replace('&gt;', '\76') + '\n';
        });
        alert(msg);
        onerror = true;
    }
    if (typeof datas['warnings'] !== "undefined" && datas['warnings'].length > 0) {
        msg = 'Des warnings ont été détectés lors de la génération du courrier:\n\n';
        datas['warnings'].forEach(function (entry) {
            msg = msg + '   -> ' + entry + '\n';
        });
        if (showwarnings === true) {
            alert(msg);
        }
    }
    if (onerror === false && datas.fichier_utilisateur_genere !== "") {
        $('#nom_fichier').val(datas['fichier_utilisateur_genere'].replaceAll('\\\\', '/'));
        return true
    }
    if (onerror === false && datas.fichier_utilisateur_genere === "" && datas.erreurs_ecriture === "false") {
        $('#nom_fichier').val(datas['autres_copies'][0].replaceAll('\\\\', '/'));
        return true
    }
    alert("Impossible d'ouvrir le document généré, consulter le suivi des traitements automatiques");
    return false;
}